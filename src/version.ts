/**
 * CLI version — read from the package's deno.json.
 * Uses readTextFileSync for local dev (file://), fetch for JSR installs (https://).
 */

const url = new URL("../deno.json", import.meta.url);

let version: string;
if (url.protocol === "file:") {
  version = JSON.parse(Deno.readTextFileSync(url)).version;
} else {
  const res = await fetch(url);
  version = (await res.json() as { version: string }).version;
}

export const CLI_VERSION: string = version;
