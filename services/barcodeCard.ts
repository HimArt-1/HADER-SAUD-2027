// =============================================================================
// نظام حاضر (Hader) — Student Barcode Card
// =============================================================================
// Renders a student's scan barcode as a self-contained PNG card that can be shown
// in the supervision screen, downloaded, or delivered to a guardian over WhatsApp.
//
// Drawing happens on a canvas rather than on a mounted DOM node: sending a whole
// class means producing hundreds of cards, and a canvas needs no layout pass.

import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { Student } from '../types';
import { isCode128Compatible, safeBarcodeFileStem } from '../components/barcode/barcodeStudioRules';

export type BarcodeCardStudent = Pick<Student, 'id' | 'name'> &
  Partial<Pick<Student, 'class_name' | 'section'>>;

export type BarcodeCardOptions = Readonly<{
  schoolName?: string;
  /** Card size in pixels. The default suits WhatsApp's image preview. */
  width?: number;
  height?: number;
  footnote?: string;
}>;

const DEFAULT_WIDTH = 820;
const DEFAULT_HEIGHT = 1040;
const DEFAULT_FOOTNOTE = 'امسح الباركود عند بوابة المدرسة لتسجيل الحضور';

const INK = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#0d9488';
const CARD_BG = '#ffffff';
const FRAME = '#e2e8f0';

/** File name for a downloaded or uploaded card. */
export const barcodeCardFileName = (student: BarcodeCardStudent): string =>
  `barcode_${safeBarcodeFileStem(student as Student)}.png`;

/** "الصف الأول - شعبة أ" style line, omitting whatever is missing. */
export const barcodeCardClassLine = (student: BarcodeCardStudent): string =>
  [student.class_name, student.section].map(part => (part ?? '').trim()).filter(Boolean).join(' - ');

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, radius: number
) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
};

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('تعذر تجهيز صورة الباركود'));
    image.src = source;
  });

/**
 * Draw the CODE128 barcode (or a QR code when the id cannot be encoded as CODE128)
 * and return it as an image ready to be placed on the card.
 */
const renderCodeImage = async (value: string): Promise<{ image: HTMLImageElement; kind: 'code128' | 'qr' }> => {
  if (isCode128Compatible(value)) {
    const barcodeCanvas = document.createElement('canvas');
    JsBarcode(barcodeCanvas, value, {
      format: 'CODE128',
      displayValue: false,
      height: 150,
      width: 3,
      margin: 8,
      background: CARD_BG,
      lineColor: INK
    });
    return { image: await loadImage(barcodeCanvas.toDataURL('image/png')), kind: 'code128' };
  }

  const qrDataUrl = await QRCode.toDataURL(value, {
    margin: 1,
    width: 460,
    errorCorrectionLevel: 'M',
    color: { dark: INK, light: CARD_BG }
  });
  return { image: await loadImage(qrDataUrl), kind: 'qr' };
};

const drawCentred = (
  ctx: CanvasRenderingContext2D,
  text: string,
  centreX: number,
  y: number,
  font: string,
  colour: string
) => {
  if (!text) return;
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centreX, y);
};

/**
 * Render the full card and hand back a PNG blob.
 * Throws a readable Arabic error when the browser refuses to produce the image.
 */
export const renderBarcodeCardPng = async (
  student: BarcodeCardStudent,
  options: BarcodeCardOptions = {}
): Promise<Blob> => {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('المتصفح لا يدعم توليد صور الباركود');

  // Arabic reads right-to-left; the canvas needs telling so punctuation sits correctly.
  try { ctx.direction = 'rtl'; } catch { /* older engines ignore this */ }

  // Card body
  ctx.fillStyle = CARD_BG;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = FRAME;
  ctx.lineWidth = 6;
  roundedRect(ctx, 18, 18, width - 36, height - 36, 32);
  ctx.stroke();

  // Accent header band
  ctx.fillStyle = ACCENT;
  roundedRect(ctx, 18, 18, width - 36, 132, 32);
  ctx.fill();
  ctx.fillRect(18, 118, width - 36, 32);

  const centre = width / 2;
  drawCentred(ctx, options.schoolName?.trim() || 'بطاقة الحضور', centre, 84, 'bold 44px system-ui, sans-serif', '#ffffff');

  // Student identity
  drawCentred(ctx, student.name?.trim() || 'طالب', centre, 236, 'bold 52px system-ui, sans-serif', INK);
  drawCentred(ctx, barcodeCardClassLine(student), centre, 306, '36px system-ui, sans-serif', MUTED);

  // Barcode panel
  const { image, kind } = await renderCodeImage(student.id);
  const panelTop = 366;
  const panelHeight = kind === 'qr' ? 470 : 300;
  ctx.fillStyle = '#f8fafc';
  roundedRect(ctx, 60, panelTop, width - 120, panelHeight, 24);
  ctx.fill();

  const maxImageWidth = width - 200;
  const scale = Math.min(maxImageWidth / image.width, (panelHeight - 60) / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, centre - drawWidth / 2, panelTop + (panelHeight - drawHeight) / 2, drawWidth, drawHeight);

  // The raw id, so a human can type it if scanning fails
  const idBaseline = panelTop + panelHeight + 68;
  ctx.direction = 'ltr';
  drawCentred(ctx, student.id, centre, idBaseline, 'bold 42px ui-monospace, monospace', INK);
  try { ctx.direction = 'rtl'; } catch { /* ignore */ }

  drawCentred(ctx, options.footnote ?? DEFAULT_FOOTNOTE, centre, height - 78, '30px system-ui, sans-serif', MUTED);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('تعذر إنشاء صورة الباركود'))),
      'image/png'
    );
  });
};

/** Render and wrap as a File, which is what the WhatsApp upload endpoint expects. */
export const renderBarcodeCardFile = async (
  student: BarcodeCardStudent,
  options: BarcodeCardOptions = {}
): Promise<File> => {
  const blob = await renderBarcodeCardPng(student, options);
  return new File([blob], barcodeCardFileName(student), { type: 'image/png' });
};
