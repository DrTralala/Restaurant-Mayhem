export function positionOf(character) {
  return { x: character.x, y: character.y };
}

export function trajectorySegment(start, end, startTime, endTime) {
  return {
    start: { ...start },
    end: { ...end },
    startTime,
    endTime,
  };
}

export function stationaryTrajectory(position) {
  return [trajectorySegment(position, position, 0, 1)];
}

export function minimumSweptDistance(startA, endA, startB, endB) {
  const relativeStart = { x: startA.x - startB.x, y: startA.y - startB.y };
  const relativeVelocity = {
    x: (endA.x - startA.x) - (endB.x - startB.x),
    y: (endA.y - startA.y) - (endB.y - startB.y),
  };
  const divisor = relativeVelocity.x ** 2 + relativeVelocity.y ** 2;
  const time = divisor === 0 ? 0 : Math.min(1, Math.max(0,
    -(relativeStart.x * relativeVelocity.x + relativeStart.y * relativeVelocity.y) / divisor,
  ));
  return Math.hypot(
    relativeStart.x + relativeVelocity.x * time,
    relativeStart.y + relativeVelocity.y * time,
  );
}

export function pointAtTrajectorySegment(segment, time) {
  const duration = segment.endTime - segment.startTime;
  if (duration <= 0) return segment.end;
  const ratio = (time - segment.startTime) / duration;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  };
}

export function minimumTimedSegmentDistance(left, right) {
  const startTime = Math.max(left.startTime, right.startTime);
  const endTime = Math.min(left.endTime, right.endTime);
  if (endTime <= startTime) return Infinity;
  const leftStart = pointAtTrajectorySegment(left, startTime);
  const leftEnd = pointAtTrajectorySegment(left, endTime);
  const rightStart = pointAtTrajectorySegment(right, startTime);
  const rightEnd = pointAtTrajectorySegment(right, endTime);
  return minimumSweptDistance(leftStart, leftEnd, rightStart, rightEnd);
}

export function minimumTrajectoryDistance(leftTrajectory, rightTrajectory) {
  let minimum = Infinity;
  for (const leftSegment of leftTrajectory) {
    for (const rightSegment of rightTrajectory) {
      minimum = Math.min(minimum, minimumTimedSegmentDistance(leftSegment, rightSegment));
    }
  }
  return minimum;
}

export function trajectoryPositionAt(trajectory, time) {
  const first = trajectory[0];
  const last = trajectory.at(-1);
  if (last && time >= last.endTime) return { ...last.end };
  if (first && time <= first.startTime) return { ...first.start };
  const segment = trajectory.find(candidate =>
    candidate.startTime <= time && time < candidate.endTime) || last;
  return pointAtTrajectorySegment(segment, Math.min(segment.endTime, Math.max(segment.startTime, time)));
}
