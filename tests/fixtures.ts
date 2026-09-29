import type { ServiceExperience } from "../lib/experience";

export const sampleExperience: ServiceExperience = {
  jobId: "11111111-1111-4111-8111-111111111111",
  assetCode: "p-204",
  assetName: "Feed Pump 204",
  assetType: "Industrial Pump",
  customerName: "Acme Chemicals",
  location: "Plant 2, Bay 4",
  technicianName: "Ravi Kumar",
  reportedProblem: "Recurring excessive vibration",
  workPerformed: "Alignment corrected",
  partsUsed: null,
  beforeMeasurement: 8.0,
  afterMeasurement: 2.7,
  measurementName: "vibration velocity",
  measurementUnit: "mm/s",
  outcome: "resolved",
  technicianNotes: "Coupling was misaligned.",
  completedAt: "2026-09-14T10:00:00.000Z",
  extraction: {
    symptom: "Excessive vibration",
    intervention: "Alignment corrected",
    intervention_category: "Alignment Correction",
    outcome: "resolved",
    lesson: "Alignment correction produced a large reduction.",
    observations: [],
  },
};
