'use client';

import { useState, useEffect } from 'react';
import { RRule } from 'rrule';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { rruleToText } from '@/lib/tasks/recurrence';

interface RecurrencePickerProps {
  value: string | null;
  endDate: string | null;
  onChange: (rule: string | null) => void;
  onEndDateChange: (date: string | null) => void;
}

const DAYS = [
  { label: 'M', value: RRule.MO, name: 'Mon' },
  { label: 'T', value: RRule.TU, name: 'Tue' },
  { label: 'W', value: RRule.WE, name: 'Wed' },
  { label: 'T', value: RRule.TH, name: 'Thu' },
  { label: 'F', value: RRule.FR, name: 'Fri' },
  { label: 'S', value: RRule.SA, name: 'Sat' },
  { label: 'S', value: RRule.SU, name: 'Sun' },
];

type Mode = 'none' | 'daily' | 'every_n_days' | 'weekly' | 'monthly' | 'custom';

function parseMode(rule: string | null): Mode {
  if (!rule) return 'none';
  if (rule.startsWith('FREQ=DAILY;INTERVAL=')) return 'every_n_days';
  if (rule === 'FREQ=DAILY') return 'daily';
  if (rule.startsWith('FREQ=WEEKLY')) return 'weekly';
  if (rule.startsWith('FREQ=MONTHLY')) return 'monthly';
  return 'custom';
}

export function RecurrencePicker({ value, endDate, onChange, onEndDateChange }: RecurrencePickerProps) {
  const [mode, setMode] = useState<Mode>(() => parseMode(value));
  const [intervalDays, setIntervalDays] = useState(2);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState(1);
  const [customRule, setCustomRule] = useState(value || '');

  useEffect(() => {
    setMode(parseMode(value));
  }, [value]);

  const buildRule = (m: Mode): string | null => {
    switch (m) {
      case 'none': return null;
      case 'daily': return 'FREQ=DAILY';
      case 'every_n_days': return `FREQ=DAILY;INTERVAL=${intervalDays}`;
      case 'weekly': {
        if (selectedDays.length === 0) return 'FREQ=WEEKLY';
        const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
        const byDay = selectedDays.map(i => dayNames[i]).join(',');
        return `FREQ=WEEKLY;BYDAY=${byDay}`;
      }
      case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${monthDay}`;
      case 'custom': return customRule.trim() || null;
    }
  };

  const handleModeChange = (m: Mode) => {
    setMode(m);
    onChange(buildRule(m));
  };

  const humanText = value ? rruleToText(value) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['none', 'daily', 'every_n_days', 'weekly', 'monthly', 'custom'] as Mode[]).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? 'default' : 'outline'}
            className="h-8 text-xs capitalize"
            onClick={() => handleModeChange(m)}
          >
            {m === 'none' ? 'No repeat' :
             m === 'every_n_days' ? 'Every N days' :
             m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
      </div>

      {mode === 'every_n_days' && (
        <div className="flex items-center gap-2 text-sm">
          <span>Every</span>
          <Input
            type="number"
            min={2}
            max={365}
            value={intervalDays}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 2;
              setIntervalDays(n);
              onChange(`FREQ=DAILY;INTERVAL=${n}`);
            }}
            className="h-8 w-20 text-sm"
          />
          <span>days</span>
        </div>
      )}

      {mode === 'weekly' && (
        <div className="flex gap-1">
          {DAYS.map((day, i) => (
            <button
              key={day.name}
              type="button"
              title={day.name}
              onClick={() => {
                const next = selectedDays.includes(i)
                  ? selectedDays.filter(d => d !== i)
                  : [...selectedDays, i];
                setSelectedDays(next);
                const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
                const byDay = next.map(idx => dayNames[idx]).join(',');
                onChange(next.length > 0 ? `FREQ=WEEKLY;BYDAY=${byDay}` : 'FREQ=WEEKLY');
              }}
              className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${
                selectedDays.includes(i)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'monthly' && (
        <div className="flex items-center gap-2 text-sm">
          <span>On day</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={monthDay}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 1;
              setMonthDay(n);
              onChange(`FREQ=MONTHLY;BYMONTHDAY=${n}`);
            }}
            className="h-8 w-20 text-sm"
          />
          <span>of the month</span>
        </div>
      )}

      {mode === 'custom' && (
        <div className="space-y-1">
          <Input
            placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2"
            value={customRule}
            onChange={(e) => {
              setCustomRule(e.target.value);
              onChange(e.target.value.trim() || null);
            }}
            className="h-8 text-xs font-mono"
          />
          <p className="text-xs text-muted-foreground">RFC 5545 RRULE string (without &quot;RRULE:&quot; prefix)</p>
        </div>
      )}

      {humanText && mode !== 'none' && (
        <p className="text-xs text-muted-foreground italic">{humanText}</p>
      )}

      {mode !== 'none' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">End date (optional)</Label>
          <Input
            type="date"
            value={endDate || ''}
            onChange={(e) => onEndDateChange(e.target.value || null)}
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}
