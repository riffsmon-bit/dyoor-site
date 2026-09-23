// Fixed public read-only inspection. No dotenv, keystore, signing or broadcasting.
import { FetchRequest, JsonRpcProvider } from "ethers";
import { inspectKuruVenue } from "../lib/droid-os/swaps/kuru-route.ts";
if (process.argv.length !== 2) throw Error("No endpoint/transaction overrides accepted");
const request = new FetchRequest("https://rpc.monad.xyz"); request.timeout = 15000;
const rpc = new JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
try { console.log(JSON.stringify(await inspectKuruVenue(rpc), null, 2)); }
finally { rpc.destroy(); }
