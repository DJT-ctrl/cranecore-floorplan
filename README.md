# Floor Plan AI Local Demo

This workspace contains a local-only Supabase Edge Function API and a small dark themed React frontend for floor plan analysis.

The browser grayscales pasted or uploaded plans before sending them to the API. The Edge Function runs a Gemini agent pipeline that extracts room geometry, classifies rooms, counts doors/windows, normalizes the data deterministically, and asks the Gemini image model to produce the annotated floor plan image with backend-generated labels and colors.

## Local Setup

1. Install frontend dependencies:

   ```sh
   cd frontend
   npm install
   ```

2. Configure Supabase function secrets:

   ```sh
   cp supabase/.env.example supabase/.env
   ```

   Add your Gemini key to `supabase/.env`. Keep it out of frontend files. The key shared in chat should be treated as exposed and rotated.

3. Run the Edge Function locally:

   ```sh
   supabase functions serve analyze-floorplan --env-file ./supabase/.env --no-verify-jwt
   ```

4. Run the frontend:

   ```sh
   cd frontend
   npm run dev
   ```

5. Open the Vite URL, usually `http://localhost:5173`.

## Models

The function keeps model names configurable in `supabase/.env`:

- `GEMINI_MODEL_NORMAL=gemini-3.1-pro`
- `GEMINI_MODEL_ENHANCED=gemini-2.5-pro`
- `GEMINI_MODEL_FALLBACK=gemini-2.5-pro`
- `GEMINI_IMAGE_MODEL=gemini-2.5-flash-image-preview`

If the requested 3.1 model is not available to your account, the backend retries the structured analysis steps with the fallback model.

## API

`POST http://localhost:54321/functions/v1/analyze-floorplan`

Request body:

```json
{
  "imageBase64": "base64 JPEG or data URL",
  "mimeType": "image/jpeg",
  "imageWidthPx": 1400,
  "imageHeightPx": 900,
  "mode": "normal",
  "pxPerCm": 2,
  "knownTotalAreaM2": 120,
  "notes": "optional user context"
}
```

Response body includes `annotatedImage`, `rooms`, `doors`, `windows`, `scale`, and `summary`.