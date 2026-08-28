import { useRef, useEffect, useCallback, useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { calculateFitCamera, createCamera, screenToWorld, adjustCameraZoom } from './camera';
import { loadSprites } from './sprites';
import { drawFloorLayer, drawFurnitureLayer, drawPlacementPreview, drawStaffLayer, drawCustomerLayer, drawOverlayLayer, drawQueueLayer, drawSelectionLayer } from './layers';
import { findClickedEntity } from './interaction';
import { getRestaurantWorld } from '../simulation/world';
import StaffDetailsPanel from '../components/StaffDetailsPanel';
import { normaliseSelectionRect, selectFurnitureInRect } from './selection';
import { snapPlacement, validatePlacement } from '../simulation/placement';

const GRID = 20;
const CHAIR_GRID = GRID / 2;

function snap(n, grid = GRID) {
  return Math.round(n / grid) * grid;
}

function buildPlacement(state, itemType, point, rotation = 0) {
  const candidate = {
    itemType,
    x: point.x,
    y: point.y,
    rotation,
  };
  return { ...candidate, ...validatePlacement(state, candidate) };
}

function samePlacement(first, second) {
  return first?.itemType === second?.itemType
    && first?.x === second?.x
    && first?.y === second?.y
    && first?.rotation === second?.rotation
    && first?.valid === second?.valid
    && first?.reason === second?.reason
    && first?.tableId === second?.tableId;
}

export default function RestaurantCanvas({
  managementOpen = false,
  fitRequest = 0,
  placementRequest = null,
  onPlacementComplete,
}) {
  const canvasRef = useRef(null);
  const cameraRef = useRef(createCamera());
  const spritesRef = useRef(loadSprites());
  const tooltipRef = useRef(null);
  const viewportRef = useRef({ w: 0, h: 0 });
  const reducedMotionRef = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const state = useGameState();
  const dispatch = useDispatch();
  const [placement, setPlacement] = useState(null);
  const placementRef = useRef(null);

  // Context menu state
  const [menu, setMenu] = useState(null); // { x, y, type, data }
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectionRect, setSelectionRect] = useState(null);
  const selectedStaff = state.staff.find(staff => staff.id === selectedStaffId) || null;

  // Move mode: object follows the cursor until the next click places it.
  const moveRef = useRef(null); // { type, id, rotation?, x, y }
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
      let renderState = state;
      if (moveRef.current) {
        const m = moveRef.current;
        if (m.type === 'table') {
          renderState = {
            ...state,
            tables: state.tables.map(t =>
              t.id === m.id ? { ...t, x: m.x, y: m.y } : t
            ),
          };
        } else if (m.type === 'chair') {
          renderState = {
            ...state,
            chairs: state.chairs.map(ch =>
              ch.id === m.id ? { ...ch, x: m.x, y: m.y, rotation: m.rotation ?? ch.rotation } : ch
            ),
          };
        } else if (m.type === 'group') {
          renderState = {
            ...state,
            tables: state.tables.map(table => {
              const item = m.items.find(candidate => candidate.type === 'table' && candidate.id === table.id);
              return item ? { ...table, x: item.x, y: item.y } : table;
            }),
            chairs: state.chairs.map(chair => {
              const item = m.items.find(candidate => candidate.type === 'chair' && candidate.id === chair.id);
              return item ? { ...chair, x: item.x, y: item.y } : chair;
            }),
          };
        }
      }

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
  }, [state, selectedItems, placement]);

  useEffect(() => {
    if (!placementRequest) {
      placementRef.current = null;
      setPlacement(null);
      return;
    }

    const origin = snapPlacement(placementRequest.itemType, { x: 200, y: 200 }, state);
    if (!origin) {
      const invalidPlacement = buildPlacement(state, placementRequest.itemType, { x: 200, y: 200 });
      placementRef.current = invalidPlacement;
      setPlacement(invalidPlacement);
      return;
    }

    const initialPlacement = buildPlacement(state, placementRequest.itemType, origin);
    placementRef.current = initialPlacement;
    setPlacement(initialPlacement);
  }, [placementRequest]);

  useEffect(() => {
    const current = placementRef.current;
    if (!placementRequest || !current || current.itemType !== placementRequest.itemType) return;

    const next = buildPlacement(state, current.itemType, current, current.rotation);
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
        const next = buildPlacement(state, currentPlacement.itemType, currentPlacement, rotation);
        placementRef.current = next;
        setPlacement(next);
        return;
      }
      if (e.key === 'r' && moveRef.current?.type === 'chair') {
        moveRef.current.rotation = ((moveRef.current.rotation ?? 0) + 1) % 4;
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
        const next = buildPlacement(state, currentPlacement.itemType, snapped, currentPlacement.rotation);
        if (!samePlacement(currentPlacement, next)) {
          placementRef.current = next;
          setPlacement(next);
        }
      }
      return;
    }
    if (moveRef.current) {
      const world = getWorldPos(e);
      if (moveRef.current.type === 'group') {
        if (!moveRef.current.anchor) {
          moveRef.current.anchor = world;
          return;
        }
        const dx = world.x - moveRef.current.anchor.x;
        const dy = world.y - moveRef.current.anchor.y;
        moveRef.current.items = moveRef.current.originalItems.map(item => ({
          ...item,
          x: item.x + dx,
          y: item.y + dy,
        }));
      } else {
        moveRef.current.x = world.x;
        moveRef.current.y = world.y;
      }
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
    if (moveRef.current) {
      const m = moveRef.current;
      if (m.type === 'group') {
        dispatch({
          type: 'MOVE_ITEMS',
          items: m.items.map(item => ({
            ...item,
            x: snap(item.x, item.type === 'chair' ? CHAIR_GRID : GRID),
            y: snap(item.y, item.type === 'chair' ? CHAIR_GRID : GRID),
          })),
        });
        setSelectedItems([]);
      } else if (m.type === 'chair') {
        dispatch({
          type: 'MOVE_CHAIR',
          id: m.id,
          x: snap(m.x, CHAIR_GRID),
          y: snap(m.y, CHAIR_GRID),
          rotation: m.rotation,
        });
      } else {
        dispatch({
          type: 'MOVE_TABLE',
          id: m.id,
          x: snap(m.x),
          y: snap(m.y),
        });
      }
      moveRef.current = null;
    }
  };

  const handleClick = (e) => {
    const currentPlacement = placementRef.current;
    if (currentPlacement) {
      if (!currentPlacement.valid) return;
      dispatch({
        type: 'PLACE_ITEM',
        itemType: currentPlacement.itemType,
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
    } else if (hit && (hit.type === 'table' || hit.type === 'chair')) {
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
    moveRef.current = {
      type: menu.type,
      id: menu.data.id,
      x: menu.data.x,
      y: menu.data.y,
      rotation: menu.data.rotation,
    };
    setMenu(null);
  };

  const handleDeleteEntity = () => {
    if (!menu) return;
    dispatch({ type: 'SELL_ITEMS', items: [{ type: menu.type, id: menu.data.id }] });
    setMenu(null);
  };

  const handleMoveSelected = () => {
    const items = selectedItems.map(item => {
      const data = item.type === 'table'
        ? state.tables.find(table => table.id === item.id)
        : state.chairs.find(chair => chair.id === item.id);
      return { ...item, x: data.x, y: data.y };
    });
    moveRef.current = {
      type: 'group',
      originalItems: items,
      items,
      anchor: null,
    };
  };

  const handleSellSelected = () => {
    dispatch({ type: 'SELL_ITEMS', items: selectedItems });
    setSelectedItems([]);
  };

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
            {menu.type === 'table' ? 'Dining table' : 'Chair'}
          </div>
          <button onClick={handleMoveEntity} style={menuBtn}>
            Move {menu.type === 'chair' ? '(R=rotate)' : ''}
          </button>
          <button onClick={handleDeleteEntity} style={{ ...menuBtn, color: '#d44' }}>
            Sell
          </button>
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
          <button onClick={handleSellSelected} style={{ ...menuBtn, color: '#ef7777' }}>Sell selected</button>
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
          Click to place · {moveRef.current.type === 'chair' ? 'R to rotate · ' : ''}Esc to cancel
        </div>
      )}

      {placement && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          fontSize: 13, fontFamily: 'monospace', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}>
          <div>Place {placement.itemType} · Click to buy · R to rotate · Right click/Esc to cancel</div>
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
