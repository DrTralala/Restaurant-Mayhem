import { useRef, useEffect, useCallback } from 'react';
import { useGameState } from '../state/GameContext';
import { createCamera } from './camera';
import { loadSprites } from './sprites';
import { drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer, drawOverlayLayer, drawQueueLayer } from './layers';
import { findClickedEntity } from './interaction';

export default function RestaurantCanvas() {
  const canvasRef = useRef(null);
  const cameraRef = useRef(createCamera());
  const spritesRef = useRef(loadSprites());
  const tooltipRef = useRef(null);
  const dragRef = useRef(null);
  const state = useGameState();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const camera = cameraRef.current;
    const sprites = spritesRef.current;

    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    canvas.style.width = canvas.clientWidth + 'px';
    canvas.style.height = canvas.clientHeight + 'px';

    drawFloorLayer(ctx, state, camera, sprites);
    drawFurnitureLayer(ctx, state, camera, sprites);
    drawStaffLayer(ctx, state, camera, sprites);
    drawCustomerLayer(ctx, state, camera, sprites);
    drawQueueLayer(ctx, state, camera, sprites);
    drawOverlayLayer(ctx, state, camera, sprites, tooltipRef.current);
  }, [state]);

  useEffect(() => {
    let animId = requestAnimationFrame(function loop() {
      draw();
      animId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);
    tooltipRef.current = hit?.text || null;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    cameraRef.current.zoom = Math.max(
      cameraRef.current.minZoom,
      Math.min(cameraRef.current.maxZoom, cameraRef.current.zoom * factor)
    );
  };

  const handleMouseDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    cameraRef.current.x += e.clientX - dragRef.current.x;
    cameraRef.current.y += e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ flex: 1, width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'grab' }}
      onClick={handleClick}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
