'use client';

import { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Trash2,
  Maximize2,
} from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ImageFloatingMenuProps {
  editor: Editor;
}

export function ImageFloatingMenu({ editor }: ImageFloatingMenuProps) {
  const [showAltDialog, setShowAltDialog] = useState(false);
  const [altText, setAltText] = useState('');
  const [title, setTitle] = useState('');

  const handleOpenAltDialog = () => {
    const attrs = editor.getAttributes('figure');
    setAltText(attrs.alt || '');
    setTitle(attrs.title || '');
    setShowAltDialog(true);
  };

  const handleSaveAlt = () => {
    editor.commands.updateAttributes('figure', {
      alt: altText,
      title: title,
    });
    setShowAltDialog(false);
  };

  const handleDelete = () => {
    editor.commands.deleteSelection();
  };

  const handleAlign = (align: 'left' | 'center' | 'right') => {
    editor.commands.updateAttributes('figure', { align });
  };

  const handlePreview = () => {
    const attrs = editor.getAttributes('figure');
    if (attrs.src) {
      window.open(attrs.src, '_blank');
    }
  };

  return (
    <>
      <BubbleMenu
        editor={editor}
        updateDelay={100}
        shouldShow={({ editor }: { editor: Editor }) => {
          return editor.isActive('figure');
        }}
      >
        <div className="flex items-center gap-1 bg-background border rounded-lg shadow-lg p-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAlign('left')}
            className="h-8 w-8 p-0"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAlign('center')}
            className="h-8 w-8 p-0"
          >
            <AlignCenter className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAlign('right')}
            className="h-8 w-8 p-0"
          >
            <AlignRight className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenAltDialog}
            className="h-8 w-8 p-0"
            title="Edit alt text"
          >
            <Type className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreview}
            className="h-8 w-8 p-0"
            title="Preview full size"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </BubbleMenu>

      <Dialog open={showAltDialog} onOpenChange={setShowAltDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Image Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="alt">Alt text (for screen readers)</Label>
              <Input
                id="alt"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Describe the image"
              />
            </div>
            <div>
              <Label htmlFor="title">Title (visible on hover)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Image title"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAltDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveAlt}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
