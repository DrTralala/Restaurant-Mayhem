import { useRef, useEffect, useCallback, useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { useRenderState, useRuntimeFault } from '../state/SimulationRuntime';
import { calculateFitCamera, createCamera, screenToWorld, adjustCameraZoom } from './camera';
import { loadSprites } from './sprites';
import { drawFloorLayer, drawFurnitureLayer, drawObjectLabel, drawPlacementPreview, drawStaffLayer, drawCustomerLayer, drawQueueLayer, drawSelectionLayer } from './layers';
import { findClickedEntity } from './interaction';
import { getDefaultStaffPosition, getMissingDoorWarnings, getRestaurantWorld } from '../simulation/world';
import StaffDetailsPanel from '../components/StaffDetailsPanel';
import { normaliseSelectionRect, selectFurnitureInRect } from './selection';
import { getFixture, getFixtureDescriptor, getFixtureLabel } from '../data/fixtures';
import { getPlaceable } from '../data/placeables';
import { snapPlacement, validateFixtureCopies, validateFixtureMoves } from '../simulation/placement';
import { getServiceSlotPosition } from '../simulation/serviceItems';
import { getDishwasherStats } from '../simulation/dishwasherProgression';
import { getWashStationOccupancy } from '../simulation/dishwashing';
import { validateStaffMove } from '../state/staffMoves';
import { projectFixtureActors } from '../simulation/navigation/occupancy';
import { useAnimationFrameLoop } from '../hooks/useAnimationFrameLoop';
import {
  getFixtureCopyEligibility,
  getFixtureCopyReasonMessage,
} from '../state/fixtureCopies';
import { getFixtureSaleEligibility } from '../state/fixtureSales';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';

import {
  buildPlacement,
  getPlacementLabel,
  samePlacement,
} from './placementInteraction';
import {
  buildCopyItems,
  buildMoveItems,
  expandSelectedFixtures,
  getFixturePlacementType,
  getMoveItem,
  isRotatableMoveItem,
} from './fixtureTransforms';

function copyValidation(state, items) {
  const eligibility = getFixtureCopyEligibility(state, items);
  if (!eligibility.valid) return eligibility;
  if (!Number.isFinite(state?.restaurant?.funds)
    || state.restaurant.funds < eligibility.price) {
    return {
      valid: false,
      reason: 'insufficient-funds',
      message: getFixtureCopyReasonMessage('insufficient-funds'),
      price: eligibility.price,
      totalPrice: eligibility.totalPrice,
      items: eligibility.items,
    };
  }
  const validation = validateFixtureCopies(state, items);
  return {
    ...validation,
    message: validation.valid ? null : getFixtureCopyReasonMessage(validation.reason),
    price: eligibility.price,
    totalPrice: eligibility.totalPrice,
    items: eligibility.items,
  };
}

export function drawCustomCashierPreview(ctx, camera, item, valid, width, height) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.fillStyle = valid ? 'rgba(70,200,110,0.45)' : 'rgba(220,70,70,0.45)';
  ctx.strokeStyle = valid ? 'rgba(70,200,110,0.9)' : 'rgba(220,70,70,0.9)';
  ctx.lineWidth = 2 / camera.zoom;
  ctx.fillRect(item.x, item.y, width, height);
  ctx.strokeRect(item.x, item.y, width, height);
  drawObjectLabel(ctx, 'Cashier', { x: item.x, y: item.y, w: width, h: height });
  ctx.restore();
}

export function drawCopyPreview(ctx, state, camera, copy) {
  const valid = copy.validation?.valid === true;
  for (const item of copy.items || []) {
    const fixture = getFixture(state, item.type, item.id);
    const itemType = fixture && getFixturePlacementType(fixture);
    if (!itemType) continue;
    if (itemType === 'cashierTable') {
      const placeable = getPlaceable(itemType);
      drawCustomCashierPreview(ctx, camera, item, valid, placeable.width, placeable.height);
      continue;
    }
    drawPlacementPreview(ctx, state, camera, {
      itemType,
      x: item.x,
      y: item.y,
      rotation: item.rotation ?? 0,
      valid,
    });
  }
}

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
        ...(item.type === 'chair' && item.tableId != null ? { tableId: item.tableId } : {}),
        ...(Object.prototype.hasOwnProperty.call(item, 'rotation')
          ? { rotation: item.rotation }
          : {}),
      };
    });
  }

  const projected = projectFixtureActors(state, preview, move.items || []);
  preview.customers = projected.customers;

  const movedServiceTableIds = new Set((move.items || [])
    .filter(item => item.type === 'serviceTable')
    .map(item => item.id));
  const movedServiceTables = new Map((Array.isArray(preview.serviceTables) ? preview.serviceTables : [])
    .filter(serviceTable => movedServiceTableIds.has(serviceTable.id))
    .map(serviceTable => [serviceTable.id, serviceTable]));
  if (Array.isArray(renderState?.serviceItems) && movedServiceTables.size > 0) {
    preview.serviceItems = renderState.serviceItems.map(serviceItem => {
      if (serviceItem.state !== 'on_service') return serviceItem;
      const serviceTable = movedServiceTables.get(serviceItem.serviceTableId);
      if (!serviceTable || !Number.isInteger(serviceItem.serviceSlotIndex)) {
        return serviceItem;
      }
      return { ...serviceItem, ...getServiceSlotPosition(serviceTable, serviceItem.serviceSlotIndex) };
    });
  }

  return preview;
}

function applyStaffMovePreview(renderState, move) {
  if (!move || !Array.isArray(renderState?.staff)) return renderState;
  return {
    ...renderState,
    staff: renderState.staff.map(worker => worker.id === move.id
      ? { ...worker, x: move.point.x, y: move.point.y }
      : worker),
  };
}

function sameStaffMove(first, second) {
  return first?.id === second?.id
    && first?.point?.x === second?.point?.x
    && first?.point?.y === second?.point?.y
    && first?.validation?.valid === second?.validation?.valid
    && first?.validation?.reason === second?.validation?.reason;
}

const CANVAS_SELL_TYPES = new Set([
  'table',
  'chair',
  'washStation',
  'staffAmenity',
]);

function canOfferFixtureSale(state, item) {
  return CANVAS_SELL_TYPES.has(item?.type)
    && getFixtureSaleEligibility(state, item).valid;
}

function formatNominalSeconds(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

function DishwasherControls({ state, station, dispatch }) {
  if (!station || station.type !== 'automatic') return null;
  const level = Number.isInteger(station.level) && station.level >= 1 && station.level <= 10
    ? station.level : 1;
  const stats = getDishwasherStats(level);
  if (!stats) return null;
  const occupancy = getWashStationOccupancy(state, station);
  const nextCost = stats.nextUpgradeCost;
  const maxed = nextCost == null;
  const funds = state.restaurant?.funds;
  const insufficientFunds = !Number.isFinite(funds) || funds < nextCost;
  const disabled = maxed || insufficientFunds;
  const buttonLabel = maxed
    ? 'Dishwasher max level'
    : `Upgrade dishwasher ($${nextCost})`;

  return (
    <div style={{
      borderTop: '1px solid #333', marginTop: 2, padding: '6px 8px 4px',
      ...TYPOGRAPHY.secondary, color: '#ccc',
    }}>
      <div style={{ color: '#f0a500' }}>Dishwasher controls</div>
      <div>Level {level} / 10</div>
      <div>Occupancy {occupancy} / {stats.capacity}</div>
      <div>Nominal {formatNominalSeconds(stats.secondsPerDish)} seconds per dish</div>
      <div>{maxed ? 'Maximum level' : `Next upgrade $${nextCost}`}</div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'UPGRADE_DISHWASHER', id: station.id })}
        disabled={disabled}
        style={{
          ...menuBtn,
          marginTop: 5,
          color: disabled ? '#666' : '#111',
          background: disabled ? '#333' : '#f0a500',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        aria-label={buttonLabel}
      >
        {buttonLabel}
      </button>
    </div>
  );
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
  const spritesRef = useRef(null);
  if (spritesRef.current === null) spritesRef.current = loadSprites();
  const viewportRef = useRef({ w: 0, h: 0 });
  const reducedMotionRef = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const state = useGameState();
  const simulationRenderState = useRenderState();
  const { fault, reportFault } = useRuntimeFault();
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
  const doorWarnings = getMissingDoorWarnings(state);

  // Move mode: object follows the cursor until the next click places it.
  const moveRef = useRef(null); // { originalItems, items, anchor, validation }
  const copyRef = useRef(null); // { originalItems, items, anchor, validation, price }
  const staffMoveRef = useRef(null); // { id, point, validation }
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

    let renderState = simulationRenderState;
    if (moveRef.current) renderState = applyMovePreview(renderState, state, moveRef.current);
    if (staffMoveRef.current) renderState = applyStaffMovePreview(renderState, staffMoveRef.current);

    drawFloorLayer(ctx, renderState, camera, sprites);
    drawFurnitureLayer(ctx, renderState, camera, sprites);
    if (placement) drawPlacementPreview(ctx, state, camera, placement);
    if (copyRef.current) drawCopyPreview(ctx, state, camera, copyRef.current);
    const characterRenderOptions = { timeMs, reducedMotion: reducedMotionRef.current };
    drawStaffLayer(ctx, renderState, camera, characterRenderOptions);
    drawCustomerLayer(ctx, renderState, camera, characterRenderOptions);
    drawQueueLayer(ctx, renderState, camera, characterRenderOptions);
    drawSelectionLayer(ctx, renderState, camera, selectedItems);
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
    const current = copyRef.current;
    if (!current) return;
    const validation = copyValidation(state, current.items);
    const next = {
      ...current,
      validation,
      price: validation.price ?? current.price,
    };
    if (current.validation?.valid !== validation.valid
      || current.validation?.reason !== validation.reason
      || current.price !== next.price) {
      copyRef.current = next;
      setMoveRevision(revision => revision + 1);
    } else {
      copyRef.current = next;
    }
  }, [state]);

  useEffect(() => {
    const current = staffMoveRef.current;
    if (!current) return;
    const validation = validateStaffMove(state, current.id, current.point);
    const next = { ...current, validation };
    if (!sameStaffMove(current, next)) {
      staffMoveRef.current = next;
      setMoveRevision(revision => revision + 1);
    }
  }, [state]);

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
    staffMoveRef.current = null;
    dragRef.current = null;
    copyRef.current = null;
    setMoveRevision(revision => revision + 1);
  }, [managementOpen]);

  useAnimationFrameLoop(timeMs => {
    try {
      draw(timeMs);
      return true;
    } catch (error) {
      reportFault(error, 'drawing');
      return false;
    }
  }, { enabled: !fault });

  // R key to rotate during move or placement
  useEffect(() => {
    const onKey = (e) => {
      const currentPlacement = placementRef.current;
      if (currentPlacement && e.key.toLowerCase() === 'r'
        && getPlaceable(currentPlacement.itemType)?.rotatable) {
        e.preventDefault();
        const rotation = ((currentPlacement.rotation ?? 0) + 1) % 4;
        const point = snapPlacement(
          currentPlacement.itemType,
          currentPlacement,
          state,
          rotation,
        ) || currentPlacement;
        const next = buildPlacement(state, currentPlacement, point, rotation);
        placementRef.current = next;
        setPlacement(next);
        return;
      }
      const moving = moveRef.current;
      if (e.key.toLowerCase() === 'r'
        && moving?.originalItems?.length === 1
        && isRotatableMoveItem(state, moving.originalItems[0])) {
        e.preventDefault();
        const rotation = ((moving.items[0].rotation ?? 0) + 1) % 4;
        moving.originalItems = moving.originalItems.map(item => ({ ...item, rotation }));
        moving.items = moving.items.map(item => ({ ...item, rotation }));
        moving.validation = validateFixtureMoves(state, moving.items);
        if (moving.validation.valid) moving.items = moving.validation.moves;
        setMoveRevision(revision => revision + 1);
      }
      if (e.key === 'Escape') {
        if (placementRef.current) {
          placementRef.current = null;
          setPlacement(null);
          onPlacementComplete?.();
        }
        copyRef.current = null;
        setMenu(null);
        setSelectedItems([]);
        setSelectionRect(null);
        moveRef.current = null;
        staffMoveRef.current = null;
        dragRef.current = null;
        setMoveRevision(revision => revision + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onPlacementComplete]);

  useEffect(() => {
    const cancelPlacement = (event) => {
      if (!placementRef.current && !copyRef.current) return;
      event.preventDefault();
      const hadPlacement = Boolean(placementRef.current);
      placementRef.current = null;
      setPlacement(null);
      copyRef.current = null;
      setMoveRevision(revision => revision + 1);
      if (hadPlacement) onPlacementComplete?.();
    };
    window.addEventListener('contextmenu', cancelPlacement);
    return () => window.removeEventListener('contextmenu', cancelPlacement);
  }, [onPlacementComplete]);

  // --- Mouse handlers ---

  const handleMouseMove = (e) => {
    const currentPlacement = placementRef.current;
    if (currentPlacement) {
      const world = getWorldPos(e);
      const snapped = snapPlacement(
        currentPlacement.itemType,
        world,
        state,
        currentPlacement.rotation,
      );
      if (snapped) {
        const next = buildPlacement(state, currentPlacement, snapped, currentPlacement.rotation);
        if (!samePlacement(currentPlacement, next)) {
          placementRef.current = next;
          setPlacement(next);
        }
      }
      return;
    }
    if (copyRef.current) {
      const copying = copyRef.current;
      if (copying.originalItems.length === 0) return;
      if (!copying.anchor) {
        const primary = copying.originalItems[0];
        copying.anchor = { x: primary.x, y: primary.y };
      }
      copying.items = buildCopyItems(state, copying.originalItems, copying.anchor, getWorldPos(e));
      copying.validation = copyValidation(state, copying.items);
      copying.price = copying.validation.price ?? copying.price;
      setMoveRevision(revision => revision + 1);
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
    if (staffMoveRef.current) {
      const world = getWorldPos(e);
      const moving = staffMoveRef.current;
      const next = {
        ...moving,
        point: world,
        validation: validateStaffMove(state, moving.id, world),
      };
      if (!sameStaffMove(moving, next)) {
        staffMoveRef.current = next;
        setMoveRevision(revision => revision + 1);
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

  const placeCopy = (world = null) => {
    const copying = copyRef.current;
    if (!copying) return;

    if (world && copying.originalItems.length > 0) {
      const primary = copying.originalItems[0];
      const anchor = copying.anchor || { x: primary.x, y: primary.y };
      copying.anchor = anchor;
      copying.items = buildCopyItems(state, copying.originalItems, anchor, world);
    }

    const validation = copyValidation(state, copying.items);
    copying.validation = validation;
    copying.price = validation.price ?? copying.price;
    if (!validation.valid) {
      setMoveRevision(revision => revision + 1);
      return;
    }

    dispatch({ type: 'COPY_FIXTURES', items: validation.copies });
    copyRef.current = null;
    setSelectedItems([]);
    setMoveRevision(revision => revision + 1);
  };

  const placeMovingStaff = () => {
    const moving = staffMoveRef.current;
    if (!moving) return;

    const validation = validateStaffMove(state, moving.id, moving.point);
    moving.validation = validation;
    if (!validation.valid) {
      setMoveRevision(revision => revision + 1);
      return;
    }

    dispatch({ type: 'MOVE_STAFF', id: moving.id, x: moving.point.x, y: moving.point.y });
    staffMoveRef.current = null;
    setSelectedStaffId(null);
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
    if (copyRef.current) {
      placeCopy(getWorldPos(e));
      return;
    }
    if (staffMoveRef.current) {
      placeMovingStaff();
      return;
    }
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);

    if (hit?.type === 'staff') {
      setMenu(null);
      setSelectedStaffId(hit.data.id);
      setSelectedItems([]);
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
    } else {
      // Clicked empty space — dismiss
      setMenu(null);
      setSelectedStaffId(null);
      setSelectedItems([]);
      if (!hit) onEmptySpaceClick?.();
    }
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0 || moveRef.current || copyRef.current || staffMoveRef.current || placementRef.current) return;
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

  const handleMoveStaff = staffId => {
    const worker = state.staff.find(candidate => candidate.id === staffId);
    if (!worker) return;
    const index = state.staff.indexOf(worker);
    const point = Number.isFinite(worker.x) && Number.isFinite(worker.y)
      ? { x: worker.x, y: worker.y }
      : getDefaultStaffPosition(worker.role, index, state, worker.id);
    staffMoveRef.current = {
      id: worker.id,
      point,
      validation: validateStaffMove(state, worker.id, point),
    };
    moveRef.current = null;
    dragRef.current = null;
    suppressClickRef.current = false;
    setMenu(null);
    setSelectedStaffId(null);
    setSelectedItems([]);
    setMoveRevision(revision => revision + 1);
  };

  const handleDeleteEntity = () => {
    if (!menu) return;
    dispatch({ type: 'SELL_ITEMS', items: [{ type: menu.type, id: menu.data.id }] });
    setMenu(null);
  };

  const handleCopySelected = () => {
    const eligibility = getFixtureCopyEligibility(state, selectedItems);
    const originalItems = eligibility.valid
      ? eligibility.items
        .map(item => getFixture(state, item.type, item.id))
        .filter(Boolean)
        .map(fixture => getMoveItem(state, fixture))
        .filter(Boolean)
      : [];
    copyRef.current = {
      originalItems,
      items: originalItems.map(item => ({ ...item })),
      anchor: null,
      validation: eligibility.valid ? copyValidation(state, originalItems) : eligibility,
      price: eligibility.price ?? 0,
    };
    moveRef.current = null;
    dragRef.current = null;
    suppressClickRef.current = false;
    setMenu(null);
    setSelectedStaffId(null);
    setMoveRevision(revision => revision + 1);
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
    copyRef.current = null;
    suppressClickRef.current = false;
    setMoveRevision(revision => revision + 1);
  };

  const handleSellSelected = () => {
    const sellableItems = selectedItems.filter(item => canOfferFixtureSale(state, item));
    if (sellableItems.length > 0) dispatch({ type: 'SELL_ITEMS', items: sellableItems });
    setSelectedItems([]);
  };

  const canMoveMenuEntity = Boolean(menu);
  const menuDoor = menu?.type === 'door' ? menu.data : null;
  const canSellMenuEntity = Boolean(menu && canOfferFixtureSale(state, {
    type: menu.type,
    id: menu.data.id,
  }));
  const sellableSelectedItems = selectedItems.filter(item =>
    canOfferFixtureSale(state, item));
  const currentCopy = copyRef.current;
  const selectedDishwasher = menu?.type === 'washStation' && menu.data?.type === 'automatic'
    ? (state.washStations || []).find(station => station.id === menu.data.id) || menu.data
    : null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: placement || currentCopy ? 'crosshair' : (moveRef.current || staffMoveRef.current) ? 'none' : 'default' }}
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
          <div style={{ ...TYPOGRAPHY.secondary, color: '#888', padding: '2px 8px' }}>
            {getFixtureLabel(state, { type: menu.type, data: menu.data }) || humaniseIdentifier(menu.type)}
          </div>
          <DishwasherControls state={state} station={selectedDishwasher} dispatch={dispatch} />
          {menuDoor && (
            <>
              {canMoveMenuEntity && (
                <button onClick={handleMoveEntity} style={menuBtn}>
                  Move
                </button>
              )}
              {menuDoor.role !== 'entrance' && (
                <button
                  onClick={() => {
                    dispatch({ type: 'SET_DOOR_ROLE', id: menuDoor.id, role: 'entrance' });
                    setMenu(null);
                  }}
                  style={menuBtn}
                >
                  Mark as entrance
                </button>
              )}
              {menuDoor.role !== 'exit' && (
                <button
                  onClick={() => {
                    dispatch({ type: 'SET_DOOR_ROLE', id: menuDoor.id, role: 'exit' });
                    setMenu(null);
                  }}
                  style={menuBtn}
                >
                  Mark as exit
                </button>
              )}
            </>
          )}
          {!menuDoor && canMoveMenuEntity && (
            <button onClick={handleMoveEntity} style={menuBtn}>
              Move
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
          onMove={handleMoveStaff}
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

      {selectedItems.length > 0 && !moveRef.current && !currentCopy && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 300,
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#16213e', border: '1px solid #f0a500', borderRadius: 8,
          ...TYPOGRAPHY.secondary, padding: '7px 10px', color: '#ddd',
        }}>
          <strong style={TYPOGRAPHY.control}>{selectedItems.length} selected</strong>
          <button onClick={handleCopySelected} style={menuBtn}>Copy</button>
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
          ...TYPOGRAPHY.control, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          Click to place · {moveRef.current.originalItems.length === 1
            && isRotatableMoveItem(state, moveRef.current.originalItems[0]) ? 'R to rotate · ' : ''}Esc to cancel
          {moveRef.current.validation && !moveRef.current.validation.valid && (
            <div style={{
              ...TYPOGRAPHY.secondary, marginTop: 4, color: '#b00000',
            }}>
              Invalid: {moveRef.current.validation.reason}
            </div>
          )}
        </div>
      )}

      {currentCopy && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          ...TYPOGRAPHY.control, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}>
          <div>Click to place copy · ${currentCopy.price} · Esc to cancel</div>
          {currentCopy.validation && !currentCopy.validation.valid && (
            <div style={{ ...TYPOGRAPHY.secondary, marginTop: 4, color: '#b00000' }}>
              Invalid: {currentCopy.validation.message || getFixtureCopyReasonMessage(currentCopy.validation.reason)}
            </div>
          )}
        </div>
      )}

      {staffMoveRef.current && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          ...TYPOGRAPHY.control, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          Click to place staff · Esc to cancel
          {staffMoveRef.current.validation && !staffMoveRef.current.validation.valid && (
            <div style={{ ...TYPOGRAPHY.secondary, marginTop: 4, color: '#b00000' }}>
              Invalid: {staffMoveRef.current.validation.reason}
            </div>
          )}
        </div>
      )}

      {placement && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          ...TYPOGRAPHY.control, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}>
          <div>Place {getPlacementLabel(state, placement)} · Click to buy · R to rotate · Right click/Esc to cancel</div>
          {!placement.valid && (
            <div style={{ ...TYPOGRAPHY.secondary, color: '#b00000', marginTop: 4 }}>Invalid: {placement.reason}</div>
          )}
        </div>
      )}

      {doorWarnings.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
            background: '#5b1f1f', color: '#ffd6d6', border: '1px solid #ef7777',
            ...TYPOGRAPHY.secondary, borderRadius: 6, padding: '8px 14px',
            display: 'flex', flexDirection: 'column', gap: 3,
          }}
        >
          {doorWarnings.map(warning => <div key={warning}>{warning}</div>)}
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
  ...TYPOGRAPHY.control,
  background: 'rgba(22,33,62,0.85)',
  color: '#ccc',
  border: '1px solid #0f3460',
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  lineHeight: 1,
  userSelect: 'none',
};

const menuBtn = {
  ...TYPOGRAPHY.control,
  background: '#1a1a2e', color: '#ccc', border: '1px solid #333',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'left',
};
