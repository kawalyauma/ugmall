import PDFDocument from "pdfkit";

export interface InvoiceData {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  orderNumber: string;
  date: Date;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  paymentMethod: string;
  paymentStatus: string;
  deliveryMethod: string;
  items: { name: string; variant?: string | null; sku: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  amountPaid: number;
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;

/** Printable A4 invoice/receipt for an order. */
export function invoicePdf(d: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const paid = d.amountPaid >= d.total;

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f766e").text(d.shopName);
    doc.font("Helvetica").fontSize(9).fillColor("#555").text(d.shopAddress).text(d.shopPhone);
    doc.moveUp(3).font("Helvetica-Bold").fontSize(16).fillColor("#111").text(paid ? "RECEIPT" : "INVOICE", { align: "right" });
    doc.font("Helvetica").fontSize(10).text(d.orderNumber, { align: "right" }).text(d.date.toLocaleDateString("en-GB", { timeZone: "Africa/Kampala" }), { align: "right" });
    doc.moveDown(2);

    const top = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).text("Bill to", 48, top);
    doc.font("Helvetica").text(d.customerName).text(d.customerPhone).text(d.deliveryAddress, { width: 250 });
    doc.font("Helvetica-Bold").text("Payment", 330, top);
    doc.font("Helvetica").text(d.paymentMethod, 330).text(`Status: ${d.paymentStatus}`, 330).text(`Delivery: ${d.deliveryMethod}`, 330);
    doc.x = 48;
    doc.moveDown(2);

    const cols = [48, 300, 360, 450];
    const row = (cells: string[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      doc.text(cells[0]!, cols[0], y, { width: 245 });
      const h = doc.y - y;
      doc.text(cells[1]!, cols[1], y, { width: 50, align: "right" });
      doc.text(cells[2]!, cols[2], y, { width: 85, align: "right" });
      doc.text(cells[3]!, cols[3], y, { width: 97, align: "right" });
      doc.y = y + Math.max(h, 12) + 4;
      doc.x = 48;
    };
    row(["Item", "Qty", "Unit price", "Amount"], true);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#ddd").stroke().moveDown(0.3);
    for (const i of d.items) row([`${i.name}${i.variant ? ` — ${i.variant}` : ""}\n${i.sku}`, String(i.quantity), ugx(i.unitPrice), ugx(i.lineTotal)]);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).stroke().moveDown(0.5);
    const tot = (label: string, v: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
      doc.text(label, 330, y, { width: 110, align: "right" });
      doc.text(v, 450, y, { width: 97, align: "right" });
      doc.moveDown(0.3);
    };
    tot("Subtotal", ugx(d.subtotal));
    tot("Delivery", ugx(d.deliveryFee));
    if (d.discount) tot("Discount", `- ${ugx(d.discount)}`);
    tot("Total", ugx(d.total), true);
    tot("Paid", ugx(d.amountPaid));
    if (!paid) tot("Balance due", ugx(d.total - d.amountPaid), true);
    doc.moveDown(3).font("Helvetica").fontSize(9).fillColor("#666").text(`Thank you for shopping with ${d.shopName}!`, 48, doc.y, { align: "center", width: 499 });
    doc.end();
  });
}
