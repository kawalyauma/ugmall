function withProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isLocalUrl(value: string) {
  try {
    const hostname = new URL(withProtocol(value)).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return false;
  }
}

export function storefrontUrl() {
  const configured = process.env.STOREFRONT_URL?.trim();
  const domain = process.env.SHOP_DOMAIN?.trim();
  const candidate = configured && !(process.env.NODE_ENV === "production" && isLocalUrl(configured))
    ? configured
    : domain || configured || "shop.notesug.com";
  return new URL(withProtocol(candidate)).origin;
}
