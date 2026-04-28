import { handleRequest } from "./index.ts";

const port = Number(Deno.env.get("FUNCTIONS_PORT") ?? "54321");
Deno.serve({ port }, handleRequest);
