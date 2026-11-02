import { describe, expect, it } from 'vitest';
import { attachment } from '../src/server/http';

describe('attachment', () => {
  it('escapes the characters RFC 5987 forbids so browsers keep the file name', () => {
    const header = attachment("Directors' written resolution (v1).docx");
    expect(header).toBe(
      'attachment; filename="Directors\' written resolution (v1).docx"; ' +
        "filename*=UTF-8''Directors%27%20written%20resolution%20%28v1%29.docx",
    );
    const encoded = header.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe("Directors' written resolution (v1).docx");
    expect(encoded).not.toMatch(/['()*]/);
  });
  it('keeps the plain fallback ASCII and quote-safe', () => {
    expect(attachment('Résumé "final".pdf')).toContain('filename="R_sum_ _final_.pdf"');
  });
});
