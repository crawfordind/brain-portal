import { describe, it, expect } from 'vitest';
import { attachmentToHtml, safeAttachmentUrl } from '@/lib/attachments/embed';

describe('attachmentToHtml', () => {
  it('embeds an image as a figure the editor parses', () => {
    const html = attachmentToHtml({
      filename: 'photo.jpg',
      storage_url: 'https://files.example.com/u/photo.jpg',
      file_type: 'image',
      description: 'A dog',
    });
    expect(html).toContain('<figure');
    expect(html).toContain('src="https://files.example.com/u/photo.jpg"');
    expect(html).toContain('alt="A dog"');
  });

  it('links other files, escaping the filename', () => {
    const html = attachmentToHtml({
      filename: '"><img src=x onerror=alert(1)>.pdf',
      storage_url: 'https://files.example.com/u/a.pdf',
      file_type: 'pdf',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;&gt;&lt;img');
    expect(html.startsWith('<p><a href="https://files.example.com/u/a.pdf">')).toBe(true);
  });

  it('never links a non-web URL', () => {
    expect(safeAttachmentUrl('javascript:alert(1)')).toBeNull();
    expect(
      attachmentToHtml({ filename: 'x', storage_url: 'javascript:alert(1)', file_type: 'pdf' })
    ).toBe('<p>x</p>');
  });
});
