import { useRef, useEffect, useCallback, useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { useRenderState } from '../state/SimulationRuntime';
import { calculateFitCamera, createCamera, screenToWorld, adjustCameraZoom } from './camera';
import { loadSprites } from './sprites';
import { drawFloorLayer, drawFurnitureLayer, drawPlacementPreview, drawStaffLayer, drawCustomerLayer, drawOverlayLayer, drawQueueLayer, drawSelectionLayer } from './layers';
import { findClickedEntity } from './interaction';
import { getRestaurantWorld } from '../simulation/world';
import StaffDetailsPanel from '../components/StaffDetailsPanel';
import { normaliseSelectionRect, selectFurnitureInRect } from './selection';
import { getFixture, getFixtureDescriptor, getFixtureLabel, getFixtureRect, listFixtures } from '../data/fixtures';
import { getPlaceable } from '../data/placeables';
import { snapPlacement, validateFixtureMoves, validatePlacement } from '../simulation/placement';

function fixtureKey(type, id) {
  return `${type}:${id}`;
}

function buildPlacement(state, request, point, rotation = 0) {
  const placementRequest = typeof request === 'string' ? { itemType: request } : request;
  const candidate = {
    ...placementRequest,
    x: point.x,
    y: point.y,
    rotation,
  };
  return { ...candidate, ...validatePlacement(state, candidate) };
}

function samePlacement(first, second) {
  return first?.itemType === second?.itemType
    && first?.equipmentId === second?.equipmentId
    && first?.x === second?.x
    && first?.y === second?.y
    && first?.rotation === second?.rotation
    && first?.valid === second?.valid
    && first?.reason === second?.reason
    && first?.tableId === second?.tableId;
}

function getFixturePlacementType(fixture) {
  const descriptor = getFixtureDescriptor(fixture?.type);
  return typeof descriptor?.placementType === 'function'
    ? descriptor.placementType(fixture?.data)
    : descriptor?.placementType;
}

function getMoveItem(state, fixture) {
  const rect = getFixtureRect(state, fixture);
  if (!rect) return null;

  const item = { type: fixture.type, id: fixture.id, x: rect.x, y: rect.y };
  if (Object.prototype.hasOwnProperty.call(fixture.data || {}, 'rotation')) {
    item.rotation = fixture.data.rotation;
  }
  return item;
}

function expandSelectedFixtures(state, selectedItems) {
  const selected = new Set((selectedItems || []).map(item => fixtureKey(item.type, item.id)));
  for (const item of selectedItems || []) {
    if (item.type !== 'table') continue;
    for (const chair of (state.chairs || []).filter(candidate => candidate.tableId === item.id)) {
      selected.add(fixtureKey('chair', chair.id));
    }
  }

  return listFixtures(state)
    .filter(fixture => selected.has(fixtureKey(fixture.type, fixture.id)))
    .map(fixture => getMoveItem(state, fixture))
    .filter(Boolean);
}

function snapMoveItem(state, item) {
  const fixture = getFixture(state, item.type, item.id);
  const placementType = fixture && getFixturePlacementType(fixture);
  const placeable = getPlaceable(placementType);
  if (!placeable) return item;

  return {
    ...item,
    x: item.type === 'door'
      ? getRestaurantWorld(state.restaurant || {}).doorX
      : Math.round(item.x / placeable.grid) * placeable.grid,
    y: Math.round(item.y / placeable.grid) * placeable.grid,
  };
}

function buildMoveItems(state, originalItems, anchor, world) {
  const deltaX = world.x - anchor.x;
  const deltaY = world.y - anchor.y;
  return originalItems
    .map(item => snapMoveItem(state, {
      ...item,
      x: item.x + deltaX,
      y: item.y + deltaY,
    }));
}

const PHYSICALLY_SEATED_CUSTOMER_STATES = new Set([
  'seated',
  'ordering',
  'waiting_for_items',
  'eating',
]);

function applyMovePreview(renderState, state, move) {
  if (!move) return renderState;
  const preview = { ...renderState };
  const movesByCollection = new Map();

  for (const item of move.items || []) {
    const descriptor = getFixtureDescriptor(item.type);
    if (!descriptor) continue;
    const collectionMoves = movesByCollection.get(descriptor.collection) || [];
    collectionMoves.push(item);
    movesByCollection.set(descriptor.collection, collectionMoves);
  }

  for (const [collection, collectionMoves] of movesByCollection) {
    if (!Array.isArray(renderState?.[collection])) continue;
    const byId = new Map(collectionMoves.map(item => [item.id, item]));
    preview[collection] = renderState[collection].map(record => {
      const item = byId.get(record.id);
      if (!item) return record;
      return {
        ...record,
        ...(item.type === 'door' ? {} : { x: item.x }),
        y: item.y,
        ...(Object.prototype.hasOwnProperty.call(item, 'rotation')
          ? { rotation: item.rotation }
          : {}),
      };
    });
  }

  const chairDeltas = new Map((move.items || [])
    .filter(item => item.type === 'chair')
    .map(item => {
      const original = move.originalItems.find(candidate =>
        candidate.type === item.type && candidate.id === item.id);
      const chair = getFixture(state, 'chair', item.id)?.data;
      return [item.id, {
        x: item.x - (original?.x ?? chair?.x),
        y: item.y - (original?.y ?? chair?.y),
        tableId: chair?.tableId,
      }];
    }));
  if (Array.isArray(renderState?.customers) && chairDeltas.size > 0) {
    preview.customers = renderState.customers.map(customer => {
      const delta = chairDeltas.get(customer.chairId);
      if (!delta || !PHYSICALLY_SEATED_CUSTOMER_STATES.has(customer.state)
        || customer.tableId !== delta.tableId) return customer;
      return {
        ...customer,
        ...(Number.isFinite(customer.x) ? { x: customer.x + delta.x } : {}),
        ...(Number.isFinite(customer.y) ? { y: customer.y + delta.y } : {}),
      };
    });
  }

  const serviceTableDeltas = new Map((move.items || [])
    .filter(item => item.type === 'serviceTable')
    .map(item => {
      const original = move.originalItems.find(candidate =>
        candidate.type === item.type && candidate.id === item.id);
      return [item.id, {
        x: item.x - original?.x,
        y: item.y - original?.y,
      }];
    }));
  if (Array.isArray(renderState?.serviceItems) && serviceTableDeltas.size > 0) {
    preview.serviceItems = renderState.serviceItems.map(serviceItem => {
      const delta = serviceTableDeltas.get(serviceItem.serviceTableId);
      if (!delta || !Number.isFinite(serviceItem.x) || !Number.isFinite(serviceItem.y)) {
        return serviceItem;
      }
      return { ...serviceItem, x: serviceItem.x + delta.x, y: serviceItem.y + delta.y };
    });
  }

  return preview;
}

function canSellItem(state, item) {
  if (item?.type === 'table') {
    return (state.tables || []).some(table => table.id === item.id && table.status === 'empty');
  }
  if (item?.type === 'chair') {
    const chair = (state.chairs || []).find(candidate => candidate.id === item.id);
    const table = chair && (state.tables || []).find(candidate => candidate.id === chair.tableId);
    return Boolean(chair && table?.status === 'empty'
      && !(state.customers || []).some(customer => customer.chairId === item.id));
  }
  if (item?.type === 'washStation') {
    const station = (state.washStations || []).find(candidate => candidate.id === item.id);
    return Boolean(station?.type === 'automatic'
      && !(state.serviceItems || []).some(serviceItem => serviceItem.washStationId === item.id
        && ['queued_for_wash', 'washing'].includes(serviceItem.state)));
  }
  return false;
}

export default function RestaurantCanvas({
  managementOpen = false,
  fitRequest = 0,
  placementRequest = null,
  onPlacementComplete,
  onEmptySpaceClick,
}) {
  const canvasRef = useRef(null);
  const cameraRef = useRef(createCamera());
  const spritesRef = useRef(loadSprites());
  const tooltipRef = useRef(null);
  const viewportRef = useRef({ w: 0, h: 0 });
  const reducedMotionRef = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const state = useGameState();
  const simulationRenderState = useRenderState();
  const dispatch = useDispatch();
  const [placement, setPlacement] = useState(null);
  const placementRef = useRef(null);

  // Context menu state
  const [menu, setMenu] = useState(null); // { x, y, type, data }
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectionRect, setSelectionRect] = useState(null);
  const [, setMoveRevision] = useState(0);
  const selectedStaff = state.staff.find(staff => staff.id === selectedStaffId) || null;

  // Move mode: object follows the cursor until the next click places it.
  const moveRef = useRef(null); // { originalItems, items, anchor, validation }
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const getWorldPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    return screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = useCallback((timeMs = 0) => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth === 0) return;
    const ctx = canvas.getContext('2d');
    const camera = cameraRef.current;
    const sprites = spritesRef.current;
    const vp = viewportRef.current;

    if (canvas.clientWidth !== vp.w || canvas.clientHeight !== vp.h) {
      vp.w = canvas.clientWidth;
      vp.h = canvas.clientHeight;
      camera.manual = false;
    }

    if (!camera.manual) {
      const world = getRestaurantWorld(state.restaurant);
      const fitted = calculateFitCamera({
        viewportWidth: canvas.clientWidth,
        viewportHeight: canvas.clientHeight,
        worldX: world.worldX,
        worldY: world.worldY,
        worldWidth: world.contentW,
        worldHeight: world.contentH,
        padding: 0,
        maxZoom: camera.maxZoom,
      });
      camera.x = fitted.x;
      camera.y = fitted.y;
      camera.zoom = fitted.zoom;
    }

    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    canvas.style.width = canvas.clientWidth + 'px';
    canvas.style.height = canvas.clientHeight + 'px';

    try {
      const renderState = moveRef.current
        ? applyMovePreview(simulationRenderState, state, moveRef.current)
        : simulationRenderState;

      drawFloorLayer(ctx, renderState, camera, sprites);
      drawFurnitureLayer(ctx, renderState, camera, sprites);
      if (placement) drawPlacementPreview(ctx, state, camera, placement);
      const characterRenderOptions = { timeMs, reducedMotion: reducedMotionRef.current };
      drawStaffLayer(ctx, renderState, camera, characterRenderOptions);
      drawCustomerLayer(ctx, renderState, camera, characterRenderOptions);
      drawQueueLayer(ctx, renderState, camera, characterRenderOptions);
      drawSelectionLayer(ctx, renderState, camera, selectedItems);
      drawOverlayLayer(ctx, renderState, camera, sprites, tooltipRef.current);
    } catch (err) {
      ctx.fillStyle = '#a33';
      ctx.font = '14px monospace';
      ctx.fillText('Render error: ' + err.message, 20, 40);
    }
  }, [state, simulationRenderState, selectedItems, placement]);

  useEffect(() => {
    if (!placementRequest) {
      placementRef.current = null;
      setPlacement(null);
      return;
    }

    const origin = snapPlacement(placementRequest.itemType, { x: 200, y: 200 }, state);
    if (!origin) {
      const invalidPlacement = buildPlacement(state, placementRequest, { x: 200, y: 200 });
      placementRef.current = invalidPlacement;
      setPlacement(invalidPlacement);
      return;
    }

    const initialPlacement = buildPlacement(state, placementRequest, origin);
    placementRef.current = initialPlacement;
    setPlacement(initialPlacement);
  }, [placementRequest]);

  useEffect(() => {
    const current = placementRef.current;
    if (!placementRequest || !current || current.itemType !== placementRequest.itemType) return;

    const next = buildPlacement(state, current, current, current.rotation);
    if (!samePlacement(current, next)) {
      placementRef.current = next;
      setPlacement(next);
    }
  }, [state, placementRequest]);

  useEffect(() => {
    cameraRef.current.manual = false;
  }, [fitRequest]);

  useEffect(() => {
    if (!managementOpen) return;
    setMenu(null);
    setSelectedStaffId(null);
    setSelectedItems([]);
    setSelectionRect(null);
    moveRef.current = null;
    dragRef.current = null;
    setMoveRevision(revision => revision + 1);
  }, [managementOpen]);

  useEffect(() => {
    let animId = requestAnimationFrame(function loop(timeMs) {
      draw(timeMs);
      animId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  // R key to rotate during move or placement
  useEffect(() => {
    const onKey = (e) => {
      const currentPlacement = placementRef.current;
      if (currentPlacement && e.key.toLowerCase() === 'r' && currentPlacement.itemType === 'chair') {
        e.preventDefault();
        const rotation = ((currentPlacement.rotation ?? 0) + 1) % 4;
        const next = buildPlacement(state, currentPlacement, currentPlacement, rotation);
        placementRef.current = next;
        setPlacement(next);
        return;
      }
      const moving = moveRef.current;
      if (e.key.toLowerCase() === 'r'
        && moving?.originalItems?.length === 1
        && moving.originalItems[0].type === 'chair') {
        const rotation = ((moving.items[0].rotation ?? 0) + 1) % 4;
        moving.originalItems = moving.originalItems.map(item => ({ ...item, rotation }));
        moving.items = moving.items.map(item => ({ ...item, rotation }));
        moving.validation = validateFixtureMoves(state, moving.items);
        setMoveRevision(revision => revision + 1);
      }
      if (e.key === 'Escape') {
        if (placementRef.current) {
          placementRef.current = null;
          setPlacement(null);
          onPlacementComplete?.();
        }
        setMenu(null);
        setSelectedItems([]);
        setSelectionRect(null);
        moveRef.current = null;
        dragRef.current = null;
        setMoveRevision(revision => revision + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onPlacementComplete]);

  useEffect(() => {
    if (!placement) return undefined;
    const cancelPlacement = (event) => {
      if (!placementRef.current) return;
      event.preventDefault();
      placementRef.current = null;
      setPlacement(null);
      onPlacementComplete?.();
    };
    window.addEventListener('contextmenu', cancelPlacement);
    return () => window.removeEventListener('contextmenu', cancelPlacement);
  }, [placement, onPlacementComplete]);

  // --- Mouse handlers ---

  const handleMouseMove = (e) => {
    const currentPlacement = placementRef.current;
    if (currentPlacement) {
      const world = getWorldPos(e);
      const snapped = snapPlacement(currentPlacement.itemType, world, state);
      if (snapped) {
        const next = buildPlacement(state, currentPlacement, snapped, currentPlacement.rotation);
        if (!samePlacement(currentPlacement, next)) {
          placementRef.current = next;
          setPlacement(next);
        }
      }
      return;
    }
    if (moveRef.current) {
      const world = getWorldPos(e);
      const moving = moveRef.current;
      if (!moving.anchor) moving.anchor = world;
      const proposedItems = buildMoveItems(state, moving.originalItems, moving.anchor, world);
      const validation = validateFixtureMoves(state, proposedItems);
      moving.items = validation.valid ? validation.moves : proposedItems;
      moving.validation = validation;
      setMoveRevision(revision => revision + 1);
      return;
    }
    if (dragRef.current && (e.buttons & 1) === 1) {
      const world = getWorldPos(e);
      dragRef.current.currentWorld = world;
      dragRef.current.currentScreen = { x: e.clientX, y: e.clientY };
      const distance = Math.hypot(
        e.clientX - dragRef.current.startScreen.x,
        e.clientY - dragRef.current.startScreen.y,
      );
      if (distance >= 4) {
        dragRef.current.dragging = true;
        setSelectionRect({
          x1: dragRef.current.startScreen.x,
          y1: dragRef.current.startScreen.y,
          x2: e.clientX,
          y2: e.clientY,
        });
      }
      return;
    }
    if (!moveRef.current && e.buttons === 0) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);
      tooltipRef.current = hit?.text || null;
    }
  };

  const placeMovingEntity = () => {
    const moving = moveRef.current;
    if (!moving) return;

    const validation = validateFixtureMoves(state, moving.items);
    moving.validation = validation;
    if (!validation.valid) {
      setMoveRevision(revision => revision + 1);
      return;
    }

    dispatch({ type: 'MOVE_FIXTURES', items: validation.moves });
    setSelectedItems([]);
    moveRef.current = null;
    setMoveRevision(revision => revision + 1);
  };

  const handleClick = (e) => {
    const currentPlacement = placementRef.current;
    if (currentPlacement) {
      if (!currentPlacement.valid) return;
      dispatch({
        type: 'PLACE_ITEM',
        itemType: currentPlacement.itemType,
        ...(currentPlacement.equipmentId ? { equipmentId: currentPlacement.equipmentId } : {}),
        x: currentPlacement.x,
        y: currentPlacement.y,
        rotation: currentPlacement.rotation,
      });
      placementRef.current = null;
      setPlacement(null);
      onPlacementComplete?.();
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (moveRef.current) {
      placeMovingEntity();
      return;
    }
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);

    if (hit?.type === 'staff') {
      setMenu(null);
      setSelectedStaffId(hit.data.id);
      setSelectedItems([]);
      tooltipRef.current = null;
    } else if (hit) {
      // Show context menu at click position
      setSelectedStaffId(null);
      setSelectedItems([]);
      setMenu({
        x: e.clientX,
        y: e.clientY,
        type: hit.type,
        data: hit.data,
      });
      tooltipRef.current = null;
    } else {
      // Clicked empty space — dismiss
      setMenu(null);
      setSelectedStaffId(null);
      setSelectedItems([]);
      tooltipRef.current = hit?.text || null;
      if (!hit) onEmptySpaceClick?.();
    }
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0 || moveRef.current || placementRef.current) return;
    const world = getWorldPos(e);
    dragRef.current = {
      startWorld: world,
      currentWorld: world,
      startScreen: { x: e.clientX, y: e.clientY },
      currentScreen: { x: e.clientX, y: e.clientY },
      dragging: false,
    };
  };

  const handleMouseUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.dragging) return;
    const items = selectFurnitureInRect(state, {
      x1: drag.startWorld.x,
      y1: drag.startWorld.y,
      x2: drag.currentWorld.x,
      y2: drag.currentWorld.y,
    });
    setSelectedItems(items);
    setSelectionRect(null);
    setMenu(null);
    setSelectedStaffId(null);
    suppressClickRef.current = true;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    adjustCameraZoom(cameraRef.current, factor);
  };

  // Context menu actions
  const handleMoveEntity = () => {
    if (!menu) return;
    const originalItems = expandSelectedFixtures(state, [{ type: menu.type, id: menu.data.id }]);
    if (originalItems.length === 0) return;
    const primary = originalItems.find(item => item.type === menu.type && item.id === menu.data.id)
      || originalItems[0];
    moveRef.current = {
      originalItems,
      items: originalItems.map(item => ({ ...item })),
      anchor: { x: primary.x, y: primary.y },
      validation: null,
    };
    setMenu(null);
    setMoveRevision(revision => revision + 1);
  };

  const handleDeleteEntity = () => {
    if (!menu) return;
    dispatch({ type: 'SELL_ITEMS', items: [{ type: menu.type, id: menu.data.id }] });
    setMenu(null);
  };

  const handleMoveSelected = () => {
    const items = expandSelectedFixtures(state, selectedItems);
    if (items.length === 0) return;
    moveRef.current = {
      originalItems: items,
      items: items.map(item => ({ ...item })),
      anchor: null,
      validation: null,
    };
    setMoveRevision(revision => revision + 1);
  };

  const handleSellSelected = () => {
    const sellableItems = selectedItems.filter(item => canSellItem(state, item));
    if (sellableItems.length > 0) dispatch({ type: 'SELL_ITEMS', items: sellableItems });
    setSelectedItems([]);
  };

  const canMoveMenuEntity = Boolean(menu);
  const canSellMenuEntity = Boolean(menu && canSellItem(state, {
    type: menu.type,
    id: menu.data.id,
  }));
  const sellableSelectedItems = selectedItems.filter(item => canSellItem(state, item));

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: placement ? 'crosshair' : moveRef.current ? 'none' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
      />

      {/* Context menu */}
      {menu && (
        <div style={{
          position: 'fixed', left: menu.x + 8, top: menu.y + 8, zIndex: 300,
          background: '#16213e', border: '1px solid #0f3460', borderRadius: 8,
          padding: 6, display: 'flex', flexDirection: 'column', gap: 4,
          minWidth: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>
          <div style={{ color: '#888', fontSize: 11, padding: '2px 8px', fontFamily: 'monospace' }}>
            {getFixtureLabel(state, { type: menu.type, data: menu.data }) || menu.type}
          </div>
          {canMoveMenuEntity && (
            <button onClick={handleMoveEntity} style={menuBtn}>
              Move {menu.type === 'chair' ? '(R=rotate)' : ''}
            </button>
          )}
          {canSellMenuEntity && (
            <button onClick={handleDeleteEntity} style={{ ...menuBtn, color: '#d44' }}>
              Sell
            </button>
          )}
        </div>
      )}

      {selectedStaff && (
        <StaffDetailsPanel
          staff={selectedStaff}
          cashierStations={state.cashierStations}
          dispatch={dispatch}
          onClose={() => setSelectedStaffId(null)}
        />
      )}

      {selectionRect && (() => {
        const rect = normaliseSelectionRect(selectionRect);
        return <div style={{
          position: 'fixed', pointerEvents: 'none', zIndex: 250,
          left: rect.left, top: rect.top,
          width: rect.right - rect.left, height: rect.bottom - rect.top,
          border: '1px solid #f0a500', background: 'rgba(240,165,0,0.12)',
        }} />;
      })()}

      {selectedItems.length > 0 && !moveRef.current && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 300,
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#16213e', border: '1px solid #f0a500', borderRadius: 8,
          padding: '7px 10px', color: '#ddd', fontFamily: 'monospace', fontSize: 12,
        }}>
          <strong>{selectedItems.length} selected</strong>
          <button onClick={handleMoveSelected} style={menuBtn}>Move selected</button>
          {sellableSelectedItems.length > 0 && (
            <button onClick={handleSellSelected} style={{ ...menuBtn, color: '#ef7777' }}>Sell selected</button>
          )}
          <button aria-label="Clear selection" onClick={() => setSelectedItems([])} style={menuBtn}>✕</button>
        </div>
      )}

      {/* Move mode indicator */}
      {moveRef.current && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          fontSize: 13, fontFamily: 'monospace', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          Click to place · {moveRef.current.originalItems.length === 1
            && moveRef.current.originalItems[0].type === 'chair' ? 'R to rotate · ' : ''}Esc to cancel
          {moveRef.current.validation && !moveRef.current.validation.valid && (
            <div style={{
              marginTop: 4, color: '#b00000', fontSize: 12, fontFamily: 'monospace',
            }}>
              Invalid: {moveRef.current.validation.reason}
            </div>
          )}
        </div>
      )}

      {placement && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          fontSize: 13, fontFamily: 'monospace', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}>
          <div>Place {placement.itemType === 'equipmentStation'
            ? state.equipment.find(equipment => equipment.id === placement.equipmentId)?.name
              || placement.itemType
            : placement.itemType} · Click to buy · R to rotate · Right click/Esc to cancel</div>
          {!placement.valid && (
            <div style={{ color: '#b00000', marginTop: 4 }}>Invalid: {placement.reason}</div>
          )}
        </div>
      )}

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12, zIndex: 200,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <button
          onClick={() => adjustCameraZoom(cameraRef.current, 1.2)}
          style={zoomBtn}
          title="Zoom in"
          aria-label="Zoom in"
        >+</button>
        <button
          onClick={() => adjustCameraZoom(cameraRef.current, 1 / 1.2)}
          style={zoomBtn}
          title="Zoom out"
          aria-label="Zoom out"
        >-</button>
      </div>
    </div>
  );
}

const zoomBtn = {
  background: 'rgba(22,33,62,0.85)',
  color: '#ccc',
  border: '1px solid #0f3460',
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'monospace',
  lineHeight: 1,
  userSelect: 'none',
};

const menuBtn = {
  background: '#1a1a2e', color: '#ccc', border: '1px solid #333',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  textAlign: 'left', fontFamily: 'monospace',
};
