import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NumberTicker } from '../components/ui/NumberTicker';

describe('statistic number rendering', () => {
  it('updates to zero when the reporting period no longer contains records', async () => {
    const view = render(<NumberTicker value={12} duration={0.02} suffix=" سجل" />);
    expect(screen.getByText('12 سجل')).toBeTruthy();
    view.rerender(<NumberTicker value={0} duration={0.02} suffix=" سجل" />);
    await waitFor(() => expect(screen.getByText('0 سجل')).toBeTruthy());
  });
  it('retains the requested decimal precision', () => {
    render(<NumberTicker value={66.7} decimals={1} suffix="%" />);
    expect(screen.getByText('66.7%')).toBeTruthy();
  });
});
