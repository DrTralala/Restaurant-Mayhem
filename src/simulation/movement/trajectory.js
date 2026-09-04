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

export function buildTimeParameterizedTrajectory(character, moved, speed, dt) {
  const start = positionOf(character);
  const end = positionOf(moved);
  const displacement = Math.hypot(end.x - start.x, end.y - start.y);
  if (displacement <= 1e-9) return stationaryTrajectory(start);
  const duration = speed * dt > 0
    ? Math.min(1, displacement / (speed * dt))
    : 1;
  const trajectory = [trajectorySegment(start, end, 0, duration)];
  if (duration < 1) trajectory.push(trajectorySegment(end, end, duration, 1));
  return trajectory;
}

export function buildDirectTrajectory(character, moved, speed, dt) {
  return buildTimeParameterizedTrajectory(character, moved, speed, dt);
}

export function buildPathTrajectory(character, pathMoved, finalMoved, speed, dt, beforeLength, continued) {
  const start = positionOf(character);
  const pathEnd = positionOf(pathMoved);
  if (beforeLength === 0 || pathMoved.path?.length === beforeLength) {
    return buildTimeParameterizedTrajectory(start, pathEnd, speed, dt);
  }

  const pathDisplacement = Math.hypot(pathEnd.x - start.x, pathEnd.y - start.y);
  const firstDuration = speed > 0 && dt > 0
    ? Math.min(1, pathDisplacement / (speed * dt))
    : 0;
  const trajectory = [trajectorySegment(start, pathEnd, 0, firstDuration)];
  if (continued) {
    const finalPosition = positionOf(finalMoved);
    const continuationDisplacement = Math.hypot(
      finalPosition.x - pathEnd.x,
      finalPosition.y - pathEnd.y,
    );
    const continuationDuration = speed > 0 && dt > 0
      ? Math.min(1 - firstDuration, continuationDisplacement / (speed * dt))
      : 0;
    trajectory.push(trajectorySegment(
      pathEnd,
      finalPosition,
      firstDuration,
      firstDuration + continuationDuration,
    ));
    if (firstDuration + continuationDuration < 1) {
      trajectory.push(trajectorySegment(finalPosition, finalPosition, firstDuration + continuationDuration, 1));
    }
    return trajectory;
  }

  if (firstDuration < 1) trajectory.push(trajectorySegment(pathEnd, pathEnd, firstDuration, 1));
  return trajectory;
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

export function minimumTrajectoryDistance(leftTrajectory, rightTrajectory) {
  let minimum = Infinity;
  for (const leftSegment of leftTrajectory) {
    for (const rightSegment of rightTrajectory) {
      const startTime = Math.max(leftSegment.startTime, rightSegment.startTime);
      const endTime = Math.min(leftSegment.endTime, rightSegment.endTime);
      if (endTime < startTime) continue;
      const leftStart = pointAtTrajectorySegment(leftSegment, startTime);
      const leftEnd = pointAtTrajectorySegment(leftSegment, endTime);
      const rightStart = pointAtTrajectorySegment(rightSegment, startTime);
      const rightEnd = pointAtTrajectorySegment(rightSegment, endTime);
      minimum = Math.min(minimum, minimumSweptDistance(leftStart, leftEnd, rightStart, rightEnd));
    }
  }
  return minimum;
}

export function coincidentStartTrajectoriesSeparateSafely(leftTrajectory, rightTrajectory) {
  const epsilon = 1e-9;
  let separatesImmediately = false;
  for (const leftSegment of leftTrajectory) {
    for (const rightSegment of rightTrajectory) {
      const startTime = Math.max(leftSegment.startTime, rightSegment.startTime);
      const endTime = Math.min(leftSegment.endTime, rightSegment.endTime);
      if (endTime - startTime <= epsilon) continue;
      const leftStart = pointAtTrajectorySegment(leftSegment, startTime);
      const leftEnd = pointAtTrajectorySegment(leftSegment, endTime);
      const rightStart = pointAtTrajectorySegment(rightSegment, startTime);
      const rightEnd = pointAtTrajectorySegment(rightSegment, endTime);
      const relativeStart = { x: leftStart.x - rightStart.x, y: leftStart.y - rightStart.y };
      const relativeEnd = { x: leftEnd.x - rightEnd.x, y: leftEnd.y - rightEnd.y };
      const relativeVelocity = {
        x: relativeEnd.x - relativeStart.x,
        y: relativeEnd.y - relativeStart.y,
      };
      const velocitySquared = relativeVelocity.x ** 2 + relativeVelocity.y ** 2;
      const startsCoincident = Math.hypot(relativeStart.x, relativeStart.y) <= epsilon;
      if (startTime <= epsilon && startsCoincident) {
        if (velocitySquared <= epsilon ** 2) return false;
        separatesImmediately = true;
      } else if (startsCoincident) return false;
      if (Math.hypot(relativeEnd.x, relativeEnd.y) <= epsilon) return false;
      if (velocitySquared > epsilon ** 2) {
        const ratio = Math.min(1, Math.max(0,
          -(relativeStart.x * relativeVelocity.x + relativeStart.y * relativeVelocity.y)
            / velocitySquared,
        ));
        const equalityTime = startTime + (endTime - startTime) * ratio;
        const distance = Math.hypot(
          relativeStart.x + relativeVelocity.x * ratio,
          relativeStart.y + relativeVelocity.y * ratio,
        );
        if (distance <= epsilon && equalityTime > epsilon) return false;
      }
    }
  }
  return separatesImmediately;
}

export function trajectoryPositionAt(trajectory, time) {
  const segment = trajectory.find(candidate => time >= candidate.startTime - 1e-9
    && time <= candidate.endTime + 1e-9) || trajectory.at(-1);
  return pointAtTrajectorySegment(segment, Math.min(segment.endTime, Math.max(segment.startTime, time)));
}

export function trajectoryPrefix(trajectory, time) {
  if (time <= 0) return stationaryTrajectory(trajectory[0].start);
  if (time >= 1) return trajectory;
  const prefix = [];
  for (const segment of trajectory) {
    if (segment.startTime >= time) break;
    const endTime = Math.min(time, segment.endTime);
    prefix.push(trajectorySegment(
      segment.start,
      pointAtTrajectorySegment(segment, endTime),
      segment.startTime,
      endTime,
    ));
    if (segment.endTime >= time) break;
  }
  const endpoint = trajectoryPositionAt(trajectory, time);
  prefix.push(trajectorySegment(endpoint, endpoint, time, 1));
  return prefix;
}

export function appendTimedSegment(trajectory, start, end, startSeconds, endSeconds, dt) {
  if (endSeconds < startSeconds || dt <= 0) return;
  trajectory.push(trajectorySegment(
    start,
    end,
    Math.min(1, startSeconds / dt),
    Math.min(1, endSeconds / dt),
  ));
}
