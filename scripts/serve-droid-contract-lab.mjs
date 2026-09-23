import { createLabServer } from "./droid-contract-lab/server.mjs";
const server = createLabServer();
server.listen(3203, "127.0.0.1", () => console.log("Droid contract lab: http://localhost:3203 — disposable local transactions only, no wallet required."));
