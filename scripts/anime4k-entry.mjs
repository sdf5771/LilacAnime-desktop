import { ImageUpscaler } from 'anime4k.js/upscaler';
import {
  Anime4K_Clamp_Highlights, Anime4K_Restore_CNN_S, Anime4K_Restore_CNN_M,
  Anime4K_Restore_CNN_Soft_M, Anime4K_Upscale_CNN_x2_S, Anime4K_Upscale_CNN_x2_M,
  Anime4K_Upscale_Denoise_CNN_x2_M
} from 'anime4k.js/shaders';

// A/B/C restoration choices, with one 2x upscale pass instead of the desktop 4x chains.
const profiles = {
  light: [Anime4K_Clamp_Highlights, Anime4K_Restore_CNN_S, Anime4K_Upscale_CNN_x2_S],
  a: [Anime4K_Clamp_Highlights, Anime4K_Restore_CNN_M, Anime4K_Upscale_CNN_x2_M],
  b: [Anime4K_Clamp_Highlights, Anime4K_Restore_CNN_Soft_M, Anime4K_Upscale_CNN_x2_M],
  c: [Anime4K_Clamp_Highlights, Anime4K_Upscale_Denoise_CNN_x2_M]
};
export { ImageUpscaler, profiles };
