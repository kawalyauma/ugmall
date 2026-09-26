import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeHtml } from "./html";

describe("sanitizeHtml", () => {
  it("keeps simple formatting and drops everything dangerous", () => {
    expect(sanitizeHtml('<p onclick="x()">Hi <b>there</b></p><ul><li>One</li></ul>')).toBe("<p>Hi <b>there</b></p><ul><li>One</li></ul>");
    expect(sanitizeHtml('<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">link</a>')).toBe("link");
    expect(sanitizeHtml("<style>p{}</style>Fish & chips <3 &amp; more")).toBe("Fish &amp; chips &lt;3 &amp; more");
    expect(sanitizeHtml("<p>a<br/>b</p>")).toBe("<p>a<br>b</p>");
  });
  it("converts to text for meta tags", () => {
    expect(htmlToText("<p>Smart</p><ul><li>Pack of 4</li></ul>")).toBe("Smart\n• Pack of 4");
  });
});
