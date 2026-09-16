import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FigureView } from './figure-view';

export interface FigureOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: {
      setFigure: (options: { src: string; alt?: string; title?: string; caption?: string }) => ReturnType;
    };
  }
}

export const Figure = Node.create<FigureOptions>({
  name: 'figure',

  group: 'block',

  content: 'inline*',

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('src'),
      },
      alt: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('alt'),
      },
      title: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('title'),
      },
      caption: {
        default: null,
        parseHTML: (element) => element.querySelector('figcaption')?.textContent,
      },
      width: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('width'),
      },
      align: {
        default: 'left',
        parseHTML: (element) => {
          const align = element.getAttribute('data-align');
          return align || 'left';
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(this.options.HTMLAttributes, { 'data-align': HTMLAttributes.align }),
      ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt, title: HTMLAttributes.title, width: HTMLAttributes.width }],
      ['figcaption', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },

  addCommands() {
    return {
      setFigure:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});
