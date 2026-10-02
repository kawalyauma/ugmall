import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { buildImportPlan, parseCategory, splitExternalId } from "./plan";
import { readCsv, readSpreadsheet } from "./spreadsheet";

const HEAD = ["Name", "Description", "SellerSKU", "ParentSKU", "Brand", "PrimaryCategory", "Price_UGX", "stock", "men_pant_size", "size", "color", "gender", "package_content", "product_weight", "MainImage"];
const csv = (rows: string[][]) => [HEAD, ...rows].map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n");
const trousers = (size: string, stock: string, price = "201600") => [
  "4-Pack Men's Office Trousers",
  "<p>Smart trousers</p><ul><li>Pack of 4</li></ul><script>alert(1)</script>",
  `MTR-001-${size}`,
  "MTR-001",
  "1039426 - Fashion",
  "1029598 - Fashion / Men's Fashion / Clothing / Pants / Trousers",
  price,
  stock,
  size,
  size,
  "Coffee Brown, Navy Blue, Black, Grey",
  "Men",
  "4 x Trousers",
  "1",
  "https://ug.jumia.is/unsafe/fit-in/300x300/product/1.jpg",
];

function plan(rows: string[][]) {
  return buildImportPlan(readSpreadsheet(strToU8(csv(rows)), "upload.csv"));
}

describe("Jumia-style variation rows", () => {
  it("groups rows by ParentSKU into ONE product with size variants (never standalone products)", () => {
    const p = plan([trousers("30", "11"), trousers("28", "11"), trousers("32", "4")]);
    expect(p.format).toBe("jumia");
    expect(p.products).toHaveLength(1);
    const prod = p.products[0]!;
    expect(prod.sku).toBe("MTR-001");
    expect(prod.optionNames).toEqual(["Size"]);
    expect(prod.variants.map((v) => v.sku)).toEqual(["MTR-001-28", "MTR-001-30", "MTR-001-32"]);
    expect(prod.variants.map((v) => v.options)).toEqual([{ Size: "28" }, { Size: "30" }, { Size: "32" }]);
    expect(prod.variants.map((v) => v.stock)).toEqual([11, 11, 4]);
    expect(prod.price).toBe(201600);
    expect(prod.weightGrams).toBe(1000);
    expect(prod.attributes).toMatchObject({ Gender: "Men", "In the box": "4 x Trousers", Colour: "Coffee Brown, Navy Blue, Black, Grey" });
    expect(prod.description).toBe("<p>Smart trousers</p><ul><li>Pack of 4</li></ul>");
    expect(prod.images).toHaveLength(1);
  });

  it("parses Jumia brand and category ids", () => {
    expect(splitExternalId("1039426 - Fashion")).toEqual({ externalId: "1039426", name: "Fashion" });
    expect(splitExternalId("Levi's")).toEqual({ externalId: null, name: "Levi's" });
    expect(parseCategory("1029598 - Fashion / Men's Fashion / Clothing / Pants / Trousers")).toEqual({
      externalId: "1029598",
      path: ["Fashion", "Men's Fashion", "Clothing", "Pants", "Trousers"],
    });
    const p = plan([trousers("30", "1")]);
    expect(p.brands).toEqual([{ externalId: "1039426", name: "Fashion" }]);
    expect(p.categories[0]!.externalId).toBe("1029598");
  });

  it("uses letter sizes in shop order and keeps per-variant prices", () => {
    const shirt = (size: string, price: string) => ["Turtleneck", "", `MTS-001-${size}`, "MTS-001", "1039426 - Fashion", "1012714 - Fashion / Men's Fashion / Clothing / Shirts / T-Shirts", price, "40", "", size, "Maroon", "Men", "", "", ""];
    const p = plan([shirt("XL", "39600"), shirt("S", "39600"), shirt("XXL", "42000"), shirt("M", "39600")]);
    const prod = p.products[0]!;
    expect(prod.variants.map((v) => v.options.Size)).toEqual(["S", "M", "XL", "XXL"]);
    expect(prod.price).toBe(39600);
    expect(prod.variants.find((v) => v.options.Size === "XXL")!.price).toBe(42000);
  });

  it("adds a Colour axis only when colour differs within a group", () => {
    const tee = (colour: string, size: string) => ["Basic Tee", "", `TEE-${colour.slice(0, 3).toUpperCase()}-${size}`, "TEE-1", "", "", "15000", "5", "", size, colour, "", "", "", ""];
    const prod = plan([tee("Black", "M"), tee("White", "M"), tee("Black", "L")]).products[0]!;
    expect(prod.optionNames).toEqual(["Colour", "Size"]);
    expect(prod.variants.map((v) => v.options)).toEqual([
      { Colour: "Black", Size: "M" },
      { Colour: "Black", Size: "L" },
      { Colour: "White", Size: "M" },
    ]);
  });

  it("skips blank rows and reports bad ones instead of guessing", () => {
    const noPrice = trousers("34", "3", "");
    const dup = trousers("28", "9");
    const p = plan([trousers("28", "11"), ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""], noPrice, dup]);
    expect(p.products[0]!.variants.map((v) => v.sku)).toEqual(["MTR-001-28"]);
    expect(p.issues.map((i) => i.message)).toEqual([expect.stringMatching(/Duplicate SKU/), expect.stringMatching(/invalid price/)]);
  });

  it("treats a row without ParentSKU as its own single-variant product", () => {
    const row = ["Leather Belt", "", "BELT-01", "", "", "", "25000", "7", "", "", "Brown", "", "", "", ""];
    const p = plan([row]);
    expect(p.products).toHaveLength(1);
    expect(p.products[0]!.sku).toBe("BELT-01");
    expect(p.products[0]!.variants).toHaveLength(1);
    expect(p.products[0]!.optionNames).toEqual([]);
  });

  it("imports explicit product labels as normalised tags", () => {
    const input = [
      ["SKU", "Name", "Price_UGX", "Tags", "Category"],
      ["PHONE-1", "Phone", "500000", '"Payment-On-Order, Uganda Electronics"', "Electronics / Phones"],
    ].map((row) => row.join(",")).join("\n");
    const p = buildImportPlan(readSpreadsheet(strToU8(input), "products.csv"));
    expect(p.products[0]!.tags).toEqual(["payment-on-order", "uganda electronics", "phones"]);
  });
});

describe("spreadsheet reader", () => {
  it("reads xlsx written with element prefixes, inline strings and shared strings", () => {
    const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const files = {
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/workbook.xml": strToU8(`<x:workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Upload Template" sheetId="1" r:id="R1"/></x:sheets></x:workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="R1" Target="/xl/worksheets/sheet1.xml" Type="x"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8(`<x:sst ${ns}><x:si><x:t>Name</x:t></x:si><x:si><x:r><x:t>Men&apos;s </x:t></x:r><x:r><x:t>Jeans &amp; Co</x:t></x:r></x:si></x:sst>`),
      "xl/worksheets/sheet1.xml": strToU8(
        `<x:worksheet ${ns}><x:sheetData>` +
          `<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>SellerSKU</x:t></x:is></x:c><x:c r="D1" t="inlineStr"><x:is><x:t>Price_UGX</x:t></x:is></x:c></x:row>` +
          `<x:row r="3"><x:c r="A3" t="s"><x:v>1</x:v></x:c><x:c r="B3" t="inlineStr"><x:is><x:t>MJN-001-30</x:t></x:is></x:c><x:c r="D3"><x:v>46800</x:v></x:c></x:row>` +
          `</x:sheetData></x:worksheet>`,
      ),
    };
    const sheet = readSpreadsheet(zipSync(files), "jumia.xlsx");
    expect(sheet.headers).toEqual(["Name", "SellerSKU", "", "Price_UGX"]);
    expect(sheet.rows).toEqual([{ __row: "3", Name: "Men's Jeans & Co", SellerSKU: "MJN-001-30", Price_UGX: "46800" }]);
  });

  it("parses CSV with quotes, newlines and semicolons", () => {
    expect(readCsv('a,b\n"x, y","line1\nline2"\n')).toEqual([["a", "b"], ["x, y", "line1\nline2"]]);
    expect(readCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("rejects files that are not spreadsheets", () => {
    expect(() => readSpreadsheet(strToU8("hello"), "x.pdf")).toThrow(/xlsx or .csv/);
  });
});
