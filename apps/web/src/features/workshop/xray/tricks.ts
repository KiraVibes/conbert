/** The views of the file X-ray (each is also a card in the workshop). */
export const XRAY_TRICKS = ['identify', 'hex', 'hashes', 'entropy', 'detective'] as const;
export type XrayTrick = (typeof XRAY_TRICKS)[number];

export const isXrayTrick = (id: string | null): id is XrayTrick =>
  XRAY_TRICKS.includes(id as XrayTrick);
