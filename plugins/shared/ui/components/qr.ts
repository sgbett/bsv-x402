import QrCreator from "qr-creator";

// ---------------------------------------------------------------------------
// QR code component — renders a QR code into a container element
// ---------------------------------------------------------------------------

/**
 * Render a QR code into the given container. Replaces any existing content.
 *
 * @param container - element to render the QR code into
 * @param data      - the string to encode (identity key, address, etc.)
 * @param size      - pixel size of the QR canvas (default 200)
 */
export function renderQR(
  container: HTMLElement,
  data: string,
  size = 200,
): void {
  container.innerHTML = "";

  QrCreator.render(
    {
      text: data,
      size,
      ecLevel: "M",
      fill: "#e0e0e0",
      background: "#1a1a2e",
      radius: 0.4,
      quiet: 1,
    },
    container,
  );
}
