/**
 * Region fog states as they appear in the snapshot (regionFog). They equal the sim's
 * Survey.Scanned / Survey.Explored ids; the ui and render layers read them from here.
 */
export const FOG_HIDDEN = 0;
export const FOG_VISIBLE = 1;
export const FOG_EXPLORED = 3;
