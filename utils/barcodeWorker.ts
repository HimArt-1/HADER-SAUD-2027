/// <reference lib="webworker" />

let barcodeDetector: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, imageBitmap, formats } = e.data;

  if (type === 'INIT') {
    if ('BarcodeDetector' in self) {
      try {
        barcodeDetector = new (self as any).BarcodeDetector({
          formats: formats || ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'qr_code', 'upc_e', 'upc_a', 'itf']
        });
        self.postMessage({ type: 'INIT_SUCCESS' });
      } catch (err: any) {
        self.postMessage({ type: 'INIT_ERROR', error: err?.message || 'Unknown error' });
      }
    } else {
      self.postMessage({ type: 'INIT_ERROR', error: 'BarcodeDetector not supported in Web Worker' });
    }
  } else if (type === 'DETECT') {
    if (!barcodeDetector || !imageBitmap) {
      self.postMessage({ type: 'DETECT_ERROR', error: 'Not initialized or missing image' });
      if (imageBitmap) imageBitmap.close();
      return;
    }

    try {
      const barcodes = await barcodeDetector.detect(imageBitmap);
      // Return just the strings to keep the message small and fast
      const rawValues = barcodes.map((b: any) => b.rawValue);
      self.postMessage({ type: 'DETECT_SUCCESS', barcodes: rawValues });
    } catch (err: any) {
      self.postMessage({ type: 'DETECT_ERROR', error: err?.message || 'Detect error' });
    } finally {
      // Free the memory immediately after detection
      if (imageBitmap) imageBitmap.close();
    }
  }
};
