import { razorAdapter } from "./razor";
import { yuzuAdapter } from "./yuzu";
import { jouleAdapter } from "./joule";
import { mosaicAdapter } from "./mosaic";
import { echelonAdapter } from "./echelon";
import { canopyAdapter } from "./canopy";
import { nativeStakingAdapter } from "./nativeStaking";
import { movePositionAdapter } from "./moveposition";
import { layerbankAdapter } from "./layerbank";
import { meridianAdapter } from "./meridian";

export const ALL_ADAPTERS = [
  ...razorAdapter,
  ...yuzuAdapter,
  ...jouleAdapter,
  ...mosaicAdapter,
  ...echelonAdapter,
  ...canopyAdapter,
  ...nativeStakingAdapter,
  ...movePositionAdapter,
  ...layerbankAdapter,
  ...meridianAdapter,
];
