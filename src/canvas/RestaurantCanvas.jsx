import { useRef, useEffect, useCallback } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { createCamera, screenToWorld } from './camera';
import { loadSprites } from './sprites';
import { drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer, drawOverlayLayer, drawQueueLayer } from './layers';
import { findClickedEntity } from './interaction';

const GRID = 20;

function snap(n) {
  return Math.round(n / GRID) * GRID;
}

export default function RestaurantCanvas() {
  const canvasRef = useRef(null);
  const cameraRef = useRef(createCamera());
  const spritesRef = useRef(loadSprites());
  const tooltipRef = useRef(null);
  const dragRef = useRef(null); // { tableId, offsetX, offsetY, currentX, currentY }
  const state = useGameState();
  const dispatch = useDispatch();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const camera = cameraRef.current;
    const sprites = spritesRef.current;
    const level = state.restaurant.expansionLevel || 1;
    const areaW = 400 + (level - 1) * 150 + 100 + 200;
    const areaH = 350 + (level - 1) * 100 + 200;

    camera.x = (canvas.clientWidth - areaW) / 2;
    camera.y = (canvas.clientHeight - areaH) / 2;

    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    canvas.style.width = canvas.clientWidth + 'px';
    canvas.style.height = canvas.clientHeight + 'px';

    // Apply drag position to tables for rendering
    let renderState = state;
    if (dragRef.current) {
      const d = dragRef.current;
      renderState = {
        ...state,
        tables: state.tables.map(t =>
          t.id === d.tableId ? { ...t, x: d.currentX, y: d.currentY } : t
        ),
      };
    }

    drawFloorLayer(ctx, renderState, camera, sprites);
    drawFurnitureLayer(ctx, renderState, camera, sprites);
    drawStaffLayer(ctx, renderState, camera, sprites);
    drawCustomerLayer(ctx, renderState, camera, sprites);
    drawQueueLayer(ctx, renderState, camera, sprites);
    drawOverlayLayer(ctx, renderState, camera, sprites, tooltipRef.current);
  }, [state]);

  useEffect(() => {
    let animId = requestAnimationFrame(function loop() {
      draw();
      animId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  const getWorldPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    return screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);
    if (hit?.type === 'table') {
      const world = getWorldPos(e);
      dragRef.current = {
        tableId: hit.data.id,
        offsetX: world.x - hit.data.x,
        offsetY: world.y - hit.data.y,
        currentX: snap(hit.data.x),
        currentY: snap(hit.data.y),
      };
    }
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    const world = getWorldPos(e);
    dragRef.current.currentX = snap(world.x - dragRef.current.offsetX);
    dragRef.current.currentY = snap(world.y - dragRef.current.offsetY);
  };

  const handleMouseUp = () => {
    if (dragRef.current) {
      dispatch({
        type: 'MOVE_TABLE',
        id: dragRef.current.tableId,
        x: snap(dragRef.current.currentX),
        y: snap(dragRef.current.currentY),
      });
      dragRef.current = null;
    }
  };

  const handleClick = (e) => {
    if (dragRef.current) return; // Don't show tooltip after drag
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);
    tooltipRef.current = hit?.text || null;
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ flex: 1, width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'default' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    />
  );
}
