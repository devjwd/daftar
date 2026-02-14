import { razorAdapter } from "./razor";
import { yuzuAdapter } from "./yuzu";
import { jouleAdapter } from "./joule";
import { mosaicAdapter } from "./mosaic";
import { echelonAdapter } from "./echelon";
import { canopyAdapter } from "./canopy";
import { movePositionAdapter } from "./moveposition";
import { meridianAdapter } from "./meridian";
import { layerbankAdapter } from "./layerbank";

export const ALL_ADAPTERS = [
  ...razorAdapter,
  ...yuzuAdapter,
  ...jouleAdapter,
  ...mosaicAdapter,
  ...echelonAdapter,
  ...canopyAdapter,
  ...movePositionAdapter,
  ...meridianAdapter,
  ...layerbankAdapter,
];