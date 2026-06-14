import { useRef, useEffect, useCallback, useState } from 'react';
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
  const state = useGameState();
  const dispatch = useDispatch();

  // Context menu state
  const [menu, setMenu] = useState(null); // { x, y, type, data }

  // Move mode: object follows cursor while LMB held
  const moveRef = useRef(null); // { type, id, rotation?, x, y }
  const mouseDownRef = useRef(false);

  const getWorldPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    return screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const camera = cameraRef.current;
    const sprites = spritesRef.current;
    const level = state.restaurant.expansionLevel || 1;
    const areaW = 400 + (level - 1) * 150 + 100 + 200;
    const areaH = 350 + (level - 1) * 100 + 200;

    camera.x = (canvas.clientWidth - areaW * camera.zoom) / 2;
    camera.y = (canvas.clientHeight - areaH * camera.zoom) / 2;

    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    canvas.style.width = canvas.clientWidth + 'px';
    canvas.style.height = canvas.clientHeight + 'px';

    // Apply move-mode ghost position
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
      }
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

  // R key to rotate during move
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' && moveRef.current?.type === 'chair') {
        moveRef.current.rotation = ((moveRef.current.rotation ?? 0) + 1) % 4;
      }
      if (e.key === 'Escape') {
        setMenu(null);
        moveRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Mouse handlers ---

  const handleMouseMove = (e) => {
    if (moveRef.current && mouseDownRef.current) {
      const world = getWorldPos(e);
      moveRef.current.x = snap(world.x);
      moveRef.current.y = snap(world.y);
      return;
    }
    if (!moveRef.current && e.buttons === 0) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);
      tooltipRef.current = hit?.text || null;
    }
  };

  const handleMouseDown = (e) => {
    if (e.button === 0) mouseDownRef.current = true;
  };

  const handleMouseUp = (e) => {
    if (e.button !== 0) return;
    mouseDownRef.current = false;
    if (moveRef.current) {
      const m = moveRef.current;
      if (m.type === 'chair') {
        dispatch({
          type: 'MOVE_CHAIR',
          id: m.id,
          x: m.x,
          y: m.y,
          rotation: m.rotation,
        });
      } else {
        dispatch({
          type: 'MOVE_TABLE',
          id: m.id,
          x: m.x,
          y: m.y,
        });
      }
      moveRef.current = null;
    }
  };

  const handleClick = (e) => {
    if (moveRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const hit = findClickedEntity(state, cameraRef.current, e.clientX - rect.left, e.clientY - rect.top);

    if (hit && (hit.type === 'table' || hit.type === 'chair')) {
      // Show context menu at click position
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
      tooltipRef.current = hit?.text || null;
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    cameraRef.current.zoom = Math.max(
      cameraRef.current.minZoom,
      Math.min(cameraRef.current.maxZoom, cameraRef.current.zoom * factor)
    );
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
    dispatch({
      type: menu.type === 'chair' ? 'DELETE_CHAIR' : 'DELETE_TABLE',
      id: menu.data.id,
    });
    setMenu(null);
  };

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: moveRef.current ? 'none' : 'default' }}
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
            {menu.type === 'table' ? `Table ${menu.data.id}` : `Chair ${menu.data.id}`}
          </div>
          <button onClick={handleMoveEntity} style={menuBtn}>
            Move {menu.type === 'chair' ? '(R=rotate)' : ''}
          </button>
          <button onClick={handleDeleteEntity} style={{ ...menuBtn, color: '#d44' }}>
            Delete
          </button>
        </div>
      )}

      {/* Move mode indicator */}
      {moveRef.current && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: '#f0a500', color: '#111', padding: '8px 20px', borderRadius: 8,
          fontSize: 13, fontFamily: 'monospace', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          Hold left mouse to drag · Release to place · R to rotate
        </div>
      )}
    </div>
  );
}

const menuBtn = {
  background: '#1a1a2e', color: '#ccc', border: '1px solid #333',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  textAlign: 'left', fontFamily: 'monospace',
};
