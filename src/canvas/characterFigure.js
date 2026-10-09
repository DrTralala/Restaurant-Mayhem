/**
 * Procedural stick-figure poses for staff, customer and queue actors.
 *
 * The historical drawing is kept exactly when no `activity` is supplied so
 * existing direct callers stay byte-compatible. With an activity string, the
 * figure switches to compact per-activity limb endpoints, head offsets and
 * small generic tool props. Props never render food or drink inventory glyphs:
 * layers keep drawing those separately and this module only adds tool outlines.
 *
 * Every activity produces periodic motion while motion is allowed and a
 * time-invariant, readable pose under reduced motion. The anchor transform is
 * always save -> translate(x, y) -> rotate -> scale, so actor coordinates,
 * seat/bed anchors and fixture rotations are never moved by the pose.
 */

const ACTIVITY_ANIMATION_SCALE = 0.006;
const PROP_COLOUR = '#f3e6bd';
const METAL_COLOUR = '#c9c9c9';
const PENCIL_COLOUR = '#ffd166';
const WATER_COLOUR = '#bfe0ff';

function animationOffset(id = '') {
  return [...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.17;
}

function drawHead(ctx, x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCup(ctx, hand) {
  ctx.strokeStyle = PROP_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(hand.x - 2, hand.y - 1, 4, 4);
}

function drawNotepadProp(ctx, pose) {
  const padX = pose.leftHand.x - 3;
  const padY = pose.leftHand.y - 3;
  ctx.fillStyle = PROP_COLOUR;
  ctx.fillRect(padX, padY, 7, 6);
  ctx.strokeStyle = '#8a7a5a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX + 1.5, padY + 2);
  ctx.lineTo(padX + 5.5, padY + 2);
  ctx.moveTo(padX + 1.5, padY + 4);
  ctx.lineTo(padX + 4.5, padY + 4);
  ctx.stroke();
  // Pencil follows the writing hand.
  ctx.strokeStyle = PENCIL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pose.rightHand.x - 2, pose.rightHand.y + 2);
  ctx.lineTo(pose.rightHand.x + 1.5, pose.rightHand.y - 1.5);
  ctx.stroke();
}

function drawClothProp(ctx, pose) {
  ctx.fillStyle = PROP_COLOUR;
  ctx.fillRect(pose.leftHand.x - 1, pose.leftHand.y + 1, 6, 3.5);
}

function drawBroomProp(ctx, pose, state) {
  const sweep = state.moving ? Math.sin(state.phase * 1.5) * 5 : 0;
  const bottomX = -8 + sweep;
  const bottomY = 21;
  ctx.strokeStyle = PROP_COLOUR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pose.leftHand.x - 1, pose.leftHand.y - 1);
  ctx.lineTo(bottomX, bottomY);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(bottomX - 3, bottomY + 1);
  ctx.lineTo(bottomX + 3, bottomY + 1);
  ctx.moveTo(bottomX - 2.5, bottomY + 1);
  ctx.lineTo(bottomX - 4.5, bottomY + 3.5);
  ctx.moveTo(bottomX + 2.5, bottomY + 1);
  ctx.lineTo(bottomX + 4.5, bottomY + 3.5);
  ctx.stroke();
}

function drawPlate(ctx, x, y) {
  ctx.strokeStyle = PROP_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.stroke();
}

function drawWashProp(ctx, pose, state) {
  drawPlate(ctx, 2, 12);
  if (state.moving) {
    ctx.strokeStyle = WATER_COLOUR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2, 6.5 + state.wave);
    ctx.lineTo(-1, 8.5 + state.wave);
    ctx.moveTo(6.5, 6 - state.wave);
    ctx.lineTo(7.5, 8 - state.wave);
    ctx.stroke();
  }
}

function drawUtensilProp(ctx, pose) {
  const hand = pose.rightHand;
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hand.x - 2, hand.y + 2);
  ctx.lineTo(hand.x + 1, hand.y - 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hand.x, hand.y - 0.5);
  ctx.lineTo(hand.x + 2, hand.y - 1.5);
  ctx.moveTo(hand.x - 0.5, hand.y + 0.5);
  ctx.lineTo(hand.x + 1.5, hand.y - 0.5);
  ctx.stroke();
  drawPlate(ctx, pose.leftHand.x, pose.leftHand.y + 1);
}

function drawTrayProp(ctx, pose) {
  ctx.strokeStyle = PROP_COLOUR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pose.leftHand.x - 2, pose.leftHand.y + 2);
  ctx.lineTo(pose.rightHand.x + 2, pose.rightHand.y + 2);
  ctx.stroke();
}

function drawStackProp(ctx, pose) {
  const centreX = (pose.leftHand.x + pose.rightHand.x) / 2;
  const topY = Math.max(pose.leftHand.y, pose.rightHand.y) + 2;
  ctx.strokeStyle = PROP_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centreX - 4, topY);
  ctx.lineTo(centreX + 4, topY);
  ctx.moveTo(centreX - 3, topY + 1.5);
  ctx.lineTo(centreX + 3, topY + 1.5);
  ctx.stroke();
}

function drawKeypadProp(ctx) {
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(3, 10, 6, 4);
  ctx.beginPath();
  ctx.moveTo(4.5, 11);
  ctx.lineTo(4.5, 13);
  ctx.moveTo(6, 11);
  ctx.lineTo(6, 13);
  ctx.moveTo(7.5, 11);
  ctx.lineTo(7.5, 13);
  ctx.stroke();
}

function drawToasterProp(ctx, pose) {
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(4, 10, 6, 4);
  ctx.beginPath();
  ctx.moveTo(5.5, 9);
  ctx.lineTo(5.5, 10);
  ctx.moveTo(8.5, 9);
  ctx.lineTo(8.5, 10);
  ctx.stroke();
  ctx.strokeStyle = PROP_COLOUR;
  ctx.beginPath();
  ctx.moveTo(10, 9);
  ctx.lineTo(pose.rightHand.x, pose.rightHand.y);
  ctx.stroke();
}

function drawOvenProp(ctx, pose) {
  // The tray stance follows the hands; a short shelf line anchors the oven.
  const push = 4 - pose.rightHand.x;
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-2 - push, 14.5, 12, 2);
  ctx.strokeStyle = PROP_COLOUR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pose.leftHand.x - 1, pose.leftHand.y + 2);
  ctx.lineTo(pose.rightHand.x + 1, pose.rightHand.y + 2);
  ctx.stroke();
}

function drawPanProp(ctx, pose) {
  const panX = pose.rightHand.x + 3;
  const panY = pose.rightHand.y + 1;
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pose.rightHand.x, pose.rightHand.y);
  ctx.lineTo(panX, panY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(panX + 2, panY + 1, 3, Math.PI * 0.1, Math.PI * 1.1);
  ctx.stroke();
  ctx.strokeStyle = PROP_COLOUR;
  ctx.beginPath();
  ctx.arc(pose.leftHand.x, pose.leftHand.y, 2.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBlenderProp(ctx) {
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(3, 11, 6, 5);
  ctx.strokeRect(5, 9, 2, 1.5);
  ctx.strokeStyle = PROP_COLOUR;
  ctx.beginPath();
  ctx.moveTo(6, 9);
  ctx.lineTo(6, 7);
  ctx.stroke();
}

function drawCoffeeProp(ctx, pose) {
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(5, 3, 7, 9);
  ctx.strokeStyle = PROP_COLOUR;
  ctx.beginPath();
  ctx.moveTo(7, 9.5);
  ctx.lineTo(7, 12);
  ctx.stroke();
  drawCup(ctx, pose.leftHand);
}

function drawDispenserProp(ctx, pose) {
  ctx.strokeStyle = METAL_COLOUR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pose.rightHand.x, 3);
  ctx.lineTo(pose.rightHand.x, pose.rightHand.y - 2);
  ctx.stroke();
  drawCup(ctx, pose.rightHand);
}

function resolvePose(activity, state) {
  const footY = state.seated ? 15 : 22;
  const { moving, wave, wave2, walking, carrying } = state;
  const pose = {
    head: { x: 0, y: 0 },
    leftHand: { x: -8, y: 10 },
    rightHand: { x: 8, y: 10 },
    leftFoot: { x: -6, y: footY },
    rightFoot: { x: 6, y: footY },
    prop: null,
  };

  switch (activity) {
    case 'waiting': {
      const sway = wave * 0.6;
      pose.head.x = sway * 0.5;
      pose.leftHand = { x: -8, y: 10 + sway * 0.3 };
      pose.rightHand = { x: 8, y: 10 - sway * 0.3 };
      break;
    }
    case 'impatient': {
      const tap = moving ? Math.max(0, wave2) * 1.5 : 1.2;
      pose.head.x = moving ? Math.sin(state.phase * 1.5) * 0.8 : 0.7;
      pose.leftHand = { x: -5, y: 11 };
      pose.rightHand = { x: 6.5, y: 9.5 - (moving ? Math.max(0, wave) * 1.2 : 0.8) };
      pose.rightFoot = { x: 6, y: footY - tap };
      break;
    }
    case 'walking': {
      const step = walking && !state.seated
        ? (moving ? wave2 * 4 : 3)
        : 0;
      pose.leftFoot = { x: -6, y: footY - step };
      pose.rightFoot = { x: 6, y: footY + step };
      if (carrying) {
        pose.leftHand = { x: -4, y: 10 + wave * 0.5 };
        pose.rightHand = { x: 4, y: 10 - wave * 0.5 };
        pose.head.y = wave * 0.4;
      } else {
        pose.leftHand = { x: -8, y: 10 + step * 0.6 + wave * 0.4 };
        pose.rightHand = { x: 8, y: 10 - step * 0.6 - wave * 0.4 };
        pose.head.y = wave * 0.3;
      }
      break;
    }
    case 'carrying': {
      const step = walking && !state.seated
        ? (moving ? wave2 * 4 : 3)
        : 0;
      pose.leftFoot = { x: -6, y: footY - step };
      pose.rightFoot = { x: 6, y: footY + step };
      pose.leftHand = { x: -4, y: 10 + wave * 0.5 };
      pose.rightHand = { x: 4, y: 10 - wave * 0.5 };
      pose.head.y = wave * 0.4;
      break;
    }
    case 'reading': {
      pose.head = { x: 1, y: 1.4 };
      pose.leftHand = { x: -3, y: 12 };
      pose.rightHand = {
        x: 3 + (moving ? Math.max(0, wave) * 2.2 : 1.2),
        y: 11 - (moving ? wave * 1.2 : 0.7),
      };
      break;
    }
    case 'eating': {
      const lift = moving ? (wave + 1) / 2 : 0.85;
      pose.head = { x: 0.5, y: 0.5 };
      pose.leftHand = { x: -5, y: 11 };
      pose.rightHand = { x: 5 - 1.7 * lift, y: 11 - 8.5 * lift };
      pose.prop = drawUtensilProp;
      break;
    }
    case 'drinking': {
      const lift = moving ? (wave + 1) / 2 : 0.85;
      pose.head = { x: 0.5, y: 0.5 };
      pose.leftHand = { x: -6, y: 11 };
      pose.rightHand = { x: 5 - 1.5 * lift, y: 11 - 8 * lift };
      pose.prop = (ctx, pose) => drawCup(ctx, pose.rightHand);
      break;
    }
    case 'paying': {
      const press = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: 1, y: 0.4 };
      pose.leftHand = { x: -7, y: 11 };
      pose.rightHand = { x: 9, y: 7.5 + press * 1.4 };
      break;
    }
    case 'taking_order': {
      const write = moving ? Math.sin(state.phase * 2.5) : 0.6;
      pose.head = { x: 0.5, y: 1.2 };
      pose.leftHand = { x: -3, y: 10.5 };
      pose.rightHand = { x: 2.5 + write, y: 9.5 };
      pose.prop = drawNotepadProp;
      break;
    }
    case 'taking_payment': {
      const press = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: 0.5, y: 0.8 };
      pose.leftHand = { x: -3, y: 9.5 };
      pose.rightHand = { x: 6, y: 7.5 + press * 2.5 };
      pose.prop = drawKeypadProp;
      break;
    }
    case 'preparing': {
      pose.head = { x: 0, y: 0.9 + wave * 0.25 };
      pose.leftHand = { x: -5, y: 11 };
      pose.rightHand = { x: 5, y: 11 - (moving ? Math.max(0, wave2) * 1.4 : 0.6) };
      break;
    }
    case 'toasting': {
      const press = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: 0, y: 0.7 };
      pose.leftHand = { x: -5, y: 11 };
      pose.rightHand = { x: 6, y: 8 + press * 2.5 };
      pose.prop = drawToasterProp;
      break;
    }
    case 'baking': {
      const push = moving ? wave * 1.2 : 0.9;
      pose.head = { x: 0, y: 0.8 };
      pose.leftHand = { x: -4 - push, y: 10 };
      pose.rightHand = { x: 4 - push, y: 10 };
      pose.prop = drawOvenProp;
      break;
    }
    case 'frying': {
      pose.head = { x: 0, y: 0.6 };
      pose.leftHand = { x: 1 + (moving ? Math.cos(state.phase * 2) * 1.2 : 0.8), y: 11 };
      pose.rightHand = { x: 7, y: 9 + (moving ? Math.sin(state.phase * 2) * 0.9 : 0.5) };
      pose.prop = drawPanProp;
      break;
    }
    case 'blending': {
      const press = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: moving ? Math.sin(state.phase * 4) * 0.4 : 0, y: 0.5 };
      pose.leftHand = { x: -6, y: 11 };
      pose.rightHand = { x: 5.5, y: 6.5 + press * 2 };
      pose.prop = drawBlenderProp;
      break;
    }
    case 'making_coffee': {
      const press = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: 0, y: 0.5 };
      pose.leftHand = { x: 7, y: 12 };
      pose.rightHand = { x: 8, y: 5.5 + press * 1.5 };
      pose.prop = drawCoffeeProp;
      break;
    }
    case 'dispensing': {
      const fill = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: 0.5, y: 0.5 };
      pose.leftHand = { x: -6, y: 10 };
      pose.rightHand = { x: 4, y: 9 - fill * 1.5 };
      pose.prop = drawDispenserProp;
      break;
    }
    case 'pickup': {
      const lift = moving ? (wave + 1) / 2 : 0.8;
      pose.head = { x: 0, y: 1.1 };
      pose.leftHand = { x: -4, y: 15 - 5 * lift };
      pose.rightHand = { x: 4, y: 15 - 5 * lift };
      break;
    }
    case 'serving': {
      const lower = moving ? (wave + 1) / 2 : 0.5;
      pose.head = { x: 0, y: 0.5 };
      pose.leftHand = { x: -5, y: 8 + lower * 1.5 };
      pose.rightHand = { x: 5, y: 8 + lower * 1.5 };
      pose.prop = drawTrayProp;
      break;
    }
    case 'collecting': {
      const gather = moving ? wave : 0.4;
      pose.head = { x: 0, y: 1.1 };
      pose.leftHand = { x: -5 + gather, y: 12 };
      pose.rightHand = { x: 5 - gather, y: 12 };
      pose.prop = drawStackProp;
      break;
    }
    case 'depositing': {
      const lower = moving ? (wave + 1) / 2 : 0.6;
      pose.head = { x: 0, y: 0.9 };
      pose.leftHand = { x: -4, y: 10 + lower * 2.5 };
      pose.rightHand = { x: 4, y: 10 + lower * 2.5 };
      pose.prop = drawStackProp;
      break;
    }
    case 'wiping': {
      const wipe = moving ? Math.sin(state.phase * 2) * 5 : 0;
      pose.head = { x: 0, y: 0.5 + wave * 0.25 };
      pose.leftHand = { x: 3 + wipe, y: 12 };
      pose.rightHand = { x: 9 + wipe, y: 12 };
      pose.prop = drawClothProp;
      break;
    }
    case 'sweeping': {
      pose.head = { x: 0.5, y: 0.5 + wave * 0.25 };
      pose.leftHand = { x: 2, y: 7 };
      pose.rightHand = { x: 7, y: 10 };
      pose.prop = drawBroomProp;
      break;
    }
    case 'washing': {
      const scrub = moving ? Math.sin(state.phase * 3) * 1.8 : 0;
      pose.head = { x: 0, y: 0.8 };
      pose.leftHand = { x: -1, y: 10 };
      pose.rightHand = {
        x: 5 + scrub,
        y: 10 + (moving ? Math.cos(state.phase * 3) * 0.5 : 0.4),
      };
      pose.prop = drawWashProp;
      break;
    }
    case 'resting': {
      const breathe = wave * 0.6;
      pose.head = { x: 0, y: -breathe * 0.4 };
      pose.leftHand = { x: -6, y: 12 + breathe * 0.3 };
      pose.rightHand = { x: 6, y: 12 - breathe * 0.3 };
      break;
    }
    case 'gaming': {
      pose.head = { x: 0, y: 0.5 };
      pose.leftHand = { x: -4, y: 9 + (moving ? Math.max(0, wave) : 0.6) * 1.5 };
      pose.rightHand = { x: 4, y: 9 + (moving ? Math.max(0, -wave) : 0.4) * 1.5 };
      break;
    }
    default: {
      // idle and unknown activity names share the safe breathing fallback.
      const breathe = wave * 0.5;
      pose.head = { x: 0, y: breathe * 0.4 };
      pose.leftHand = { x: -8, y: 10 + breathe * 0.3 };
      pose.rightHand = { x: 8, y: 10 - breathe * 0.3 };
      break;
    }
  }

  return pose;
}

function applyGesture(pose, gesture, state) {
  const reach = state.moving ? (state.wave + 1) / 2 : 0.6;

  switch (gesture) {
    case 'pickup':
      pose.head = { x: 0, y: 1 };
      pose.leftHand = { x: -4, y: 14.5 - 4.5 * reach };
      pose.rightHand = { x: 4, y: 14.5 - 4.5 * reach };
      break;
    case 'serving':
      pose.leftHand = { x: -5, y: 8.5 + (1 - reach) * 1.5 };
      pose.rightHand = { x: 5, y: 8.5 + (1 - reach) * 1.5 };
      break;
    case 'collecting':
      pose.leftHand = { x: -4 + reach * 2, y: 12.5 };
      pose.rightHand = { x: 4 - reach * 2, y: 12.5 };
      break;
    case 'depositing':
      pose.leftHand = { x: -4, y: 10.5 + reach * 2 };
      pose.rightHand = { x: 4, y: 10.5 + reach * 2 };
      break;
    default:
      break;
  }
}

function drawLyingActivity(ctx, activity, state) {
  const breathe = state.moving ? Math.sin(state.phase) * 0.4 : 0;

  drawHead(ctx, 0, breathe * 0.2);

  ctx.beginPath();
  ctx.moveTo(4, breathe);
  ctx.lineTo(16, breathe);
  ctx.moveTo(8, breathe - 3);
  ctx.lineTo(8, breathe + 5);
  ctx.moveTo(16, breathe);
  ctx.lineTo(23, breathe - 5);
  ctx.moveTo(16, breathe);
  ctx.lineTo(23, breathe + 5);
  ctx.stroke();

  if (activity === 'sleeping') {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '7px sans-serif';
    ctx.fillText('z', 20, -7);
    // The drifting second cue is a transient accent, so it is suppressed
    // under reduced motion while the static cue above stays readable.
    if (state.moving) ctx.fillText('z', 25, -11);
  }
}

function drawActivityPose(ctx, activity, color, options) {
  const reducedMotion = Boolean(options.reducedMotion);
  const moving = !reducedMotion;
  const timeMs = Number.isFinite(options.timeMs) ? options.timeMs : 0;
  const phase = moving ? timeMs * ACTIVITY_ANIMATION_SCALE + animationOffset(options.id) : 0;
  const state = {
    moving,
    phase,
    wave: moving ? Math.sin(phase) : 0,
    wave2: moving ? Math.sin(phase * 2) : 0,
    seated: options.seated === true,
    lying: options.lying === true,
    walking: options.walking === true,
    carrying: options.carrying === true,
  };

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  if (state.lying || activity === 'sleeping') {
    drawLyingActivity(ctx, activity, state);
    return;
  }

  const pose = resolvePose(activity, state);
  if (options.gesture && !reducedMotion) applyGesture(pose, options.gesture, state);

  drawHead(ctx, pose.head.x, pose.head.y);
  ctx.beginPath();
  ctx.moveTo(pose.head.x, pose.head.y + 4);
  ctx.lineTo(0, 14);
  ctx.moveTo(0, 7);
  ctx.lineTo(pose.leftHand.x, pose.leftHand.y);
  ctx.moveTo(0, 7);
  ctx.lineTo(pose.rightHand.x, pose.rightHand.y);
  ctx.moveTo(0, 14);
  ctx.lineTo(pose.leftFoot.x, pose.leftFoot.y);
  ctx.moveTo(0, 14);
  ctx.lineTo(pose.rightFoot.x, pose.rightFoot.y);
  ctx.stroke();

  if (typeof pose.prop === 'function') pose.prop(ctx, pose, state);
}

/**
 * Draw the historical pose exactly. Kept in the same call order and with the
 * same coordinates, styles and conditional accents as layers.js so legacy
 * calls remain byte-identical.
 */
function drawLegacyPose(ctx, color, {
  seated, lying, walking, cleaning, timeMs, reducedMotion, id,
}) {
  const localX = 0;
  const localY = 0;
  const stride = walking && !cleaning && !reducedMotion
    ? Math.sin(timeMs * 0.012 + animationOffset(id)) * 4
    : 0;
  const wipe = cleaning && !reducedMotion
    ? Math.sin(timeMs * 0.012 + animationOffset(id)) * 5
    : 0;
  const leftHandX = cleaning ? localX + 3 + wipe : localX - 8;
  const rightHandX = cleaning ? localX + 9 + wipe : localX + 8;
  const handY = cleaning ? localY + 12 : localY + 10;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(localX, localY, 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  if (lying) {
    // A resident on a bed is drawn along the bed's long axis. The caller
    // rotates this small pose to match the furniture, so the head stays at
    // the authoritative slot anchor instead of being re-positioned by the
    // renderer.
    ctx.moveTo(localX + 4, localY);
    ctx.lineTo(localX + 16, localY);
    ctx.moveTo(localX + 8, localY - 3);
    ctx.lineTo(localX + 8, localY + 5);
    ctx.moveTo(localX + 16, localY);
    ctx.lineTo(localX + 23, localY - 5);
    ctx.moveTo(localX + 16, localY);
    ctx.lineTo(localX + 23, localY + 5);
  } else {
    ctx.moveTo(localX, localY + 4);
    ctx.lineTo(localX, localY + 14);
    ctx.moveTo(localX, localY + 7);
    ctx.lineTo(leftHandX, handY + stride);
    ctx.moveTo(localX, localY + 7);
    ctx.lineTo(rightHandX, handY - stride);
    ctx.moveTo(localX, localY + 14);
    ctx.lineTo(localX - 6, seated ? localY + 15 : localY + 22 - stride);
    ctx.moveTo(localX, localY + 14);
    ctx.lineTo(localX + 6, seated ? localY + 15 : localY + 22 + stride);
  }
  ctx.stroke();

  if (cleaning) {
    ctx.strokeStyle = '#f3e6bd';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(leftHandX - 1, handY + 3);
    ctx.lineTo(rightHandX + 2, handY + 3);
    ctx.stroke();
  }
}

export function drawStickFigure(ctx, x, y, color, options = {}) {
  const settings = options || {};
  const {
    seated = false,
    lying = false,
    walking = false,
    cleaning = false,
    timeMs = 0,
    reducedMotion = false,
    id = '',
    scale = 1,
    rotation = 0,
    activity = null,
  } = settings;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);

  if (activity) {
    drawActivityPose(ctx, activity, color, settings);
  } else {
    drawLegacyPose(ctx, color, { seated, lying, walking, cleaning, timeMs, reducedMotion, id });
  }

  ctx.restore();
}
