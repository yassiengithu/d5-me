const PLATFORM_COMMISSION_RATE = 0.08;

export const calculatePlatformFee = (subtotal: number) => Math.round(subtotal * PLATFORM_COMMISSION_RATE);

export const PLATFORM_COMMISSION_LABEL = `Platform fee (${Math.round(PLATFORM_COMMISSION_RATE * 100)}%)`;