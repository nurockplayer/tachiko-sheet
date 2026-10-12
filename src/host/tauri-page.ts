import { invoke } from "@tauri-apps/api/core";

/**
 * This page's identity, issued by the desktop host when it allowed the page to
 * load and learned once when the page starts. It fences this page's saves and
 * runtime attaches from those of earlier pages.
 */
export const pageIdentity: Promise<number> = invoke<number>("page_identity");
