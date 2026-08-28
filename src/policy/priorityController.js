import { priorityValues } from "../schemas/recoveryIntent.js";

const emergencyConditions = new Set([
  "MEDICAL_EMERGENCY",
  "DISASTER_EMERGENCY"
]);

function highestPriority(levels) {
  return levels.reduce((highest, level) => {
    if (!priorityValues.includes(level)) {
      throw new TypeError(`Unknown priority level: ${level}`);
    }

    return priorityValues.indexOf(level) < priorityValues.indexOf(highest)
      ? level
      : highest;
  }, "P5");
}

export function assignPriority({
  detectedConditions = [],
  affectedServices = [],
  commercialPriority = "P3"
}) {
  const emergencyOverride = detectedConditions.some((condition) =>
    emergencyConditions.has(condition)
  );

  if (emergencyOverride) {
    return { level: "P0", emergencyOverride: true };
  }

  const levels = affectedServices.map((service) => service.priority);
  const level = levels.length > 0 ? highestPriority(levels) : commercialPriority;

  if (!priorityValues.includes(level)) {
    throw new TypeError(`Unknown commercial priority level: ${level}`);
  }

  return { level, emergencyOverride: false };
}

export function orderServicesByPriority(services) {
  return services
    .map((service, originalIndex) => ({ service, originalIndex }))
    .sort((left, right) => {
      const priorityDifference =
        priorityValues.indexOf(left.service.priority) -
        priorityValues.indexOf(right.service.priority);

      return priorityDifference || left.originalIndex - right.originalIndex;
    })
    .map(({ service }) => service);
}
