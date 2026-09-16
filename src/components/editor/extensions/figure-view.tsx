'use client';

import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';

export function FigureView({ node, updateAttributes, selected, editor }: any) {
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidth] = useState<number>(node.attrs.width || 400);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(100, Math.min(800, startWidth + (moveEvent.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      updateAttributes({ width });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    if (!isResizing) {
      updateAttributes({ width });
    }
  }, [isResizing, width, updateAttributes]);

  const alignment = node.attrs.align || 'left';

  return (
    <NodeViewWrapper
      className={cn(
        'figure-wrapper my-4 relative group',
        alignment === 'center' && 'mx-auto text-center',
        alignment === 'right' && 'ml-auto text-right',
        selected && 'ring-2 ring-primary rounded'
      )}
      style={{ maxWidth: `${width}px` }}
      data-drag-handle
    >
      {/* Drag Handle */}
      <div
        className="absolute left-0 top-0 h-full w-6 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        contentEditable={false}
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </div>

      {/* Image */}
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt || ''}
        title={node.attrs.title || ''}
        className="rounded-lg max-w-full h-auto"
        style={{ width: `${width}px` }}
        draggable={false}
      />

      {/* Resize Handle */}
      {selected && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 bg-primary cursor-se-resize"
          onMouseDown={handleMouseDown}
          contentEditable={false}
        />
      )}

      {/* Caption */}
      <figcaption
        className={cn(
          'text-sm text-muted-foreground mt-2 px-2',
          alignment === 'center' && 'text-center',
          alignment === 'right' && 'text-right'
        )}
      >
        <NodeViewContent className="caption-content outline-none" />
      </figcaption>
    </NodeViewWrapper>
  );
}
