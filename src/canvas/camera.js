export function createCamera() {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.2,
    maxZoom: 3,
    manual: false,
  };
}

export function calculateFitCamera({
  viewportWidth,
  viewportHeight,
  worldX,
  worldY,
  worldWidth,
  worldHeight,
  padding = 24,
  maxZoom = 1,
}) {
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const zoom = Math.min(maxZoom, availableWidth / worldWidth, availableHeight / worldHeight);

  return {
    x: viewportWidth / 2 - (worldX + worldWidth / 2) * zoom,
    y: viewportHeight / 2 - (worldY + worldHeight / 2) * zoom,
    zoom,
  };
}

export function screenToWorld(camera, screenX, screenY) {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

export function adjustCameraZoom(camera, factor) {
  camera.manual = true;
  camera.zoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom * factor));
  return camera;
}

export function resetCameraMode(camera) {
  camera.manual = false;
  return camera;
}
