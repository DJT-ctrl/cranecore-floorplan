const pointSchema = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
  required: ["x", "y"],
};

const roomTypeValues = [
  "bedroom",
  "bathroom",
  "kitchen",
  "hall",
  "livingRoom",
  "diningRoom",
  "corridor",
  "closet",
  "utility",
  "office",
  "other",
];

export const geometrySchema = {
  type: "object",
  properties: {
    imageWidthPx: { type: "number" },
    imageHeightPx: { type: "number" },
    totalAreaM2: { type: "number" },
    inferredScale: {
      type: "object",
      properties: {
        pxPerM: { type: "number" },
        source: {
          type: "string",
          enum: [
            "dimensionLabel",
            "fallback",
            "userOverride",
            "knownTotalArea",
            "unknown",
          ],
        },
        confidence: { type: "number" },
        explanation: { type: "string" },
      },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          suggestedName: { type: "string" },
          polygon: {
            type: "array",
            items: pointSchema,
          },
          areaM2: { type: "number" },
          dimensionsLabelsFound: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: "number" },
        },
        required: ["id", "polygon"],
      },
    },
    notes: {
      type: "array",
      items: { type: "string" },
    },
    outerOutline: {
      type: "array",
      items: pointSchema,
    },
    walls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          polyline: { type: "array", items: pointSchema },
          thicknessM: { type: "number" },
          confidence: { type: "number" },
        },
        required: ["polyline", "thicknessM"],
      },
    },
    glazing: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          polyline: { type: "array", items: pointSchema },
          thicknessM: { type: "number" },
          roomId: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["polyline"],
      },
    },
  },
  required: [
    "rooms",
    "totalAreaM2",
    "inferredScale",
    "outerOutline",
    "walls",
    "glazing",
  ],
};

export const classificationSchema = {
  type: "object",
  properties: {
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: roomTypeValues },
          confidence: { type: "number" },
        },
        required: ["id", "name", "type"],
      },
    },
  },
  required: ["rooms"],
};

export const openingsSchema = {
  type: "object",
  properties: {
    doors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          position: pointSchema,
          roomIds: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: "number" },
        },
        required: ["position"],
      },
    },
    windows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          position: pointSchema,
          roomId: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["position"],
      },
    },
  },
  required: ["doors", "windows"],
};
