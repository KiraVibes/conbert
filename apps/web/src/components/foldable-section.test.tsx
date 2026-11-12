import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoldableSection } from './FoldableSection';

describe('foldable section', () => {
  it('starts closed with the number of entries and opens on click', () => {
    render(
      <FoldableSection id="x" title="Abos" count={3} foldable>
        <p>inside</p>
      </FoldableSection>,
    );
    const toggle = screen.getByRole('button', { name: /Abos/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('3');
    expect(screen.queryByText('inside')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  it('shows everything without a button when not foldable', () => {
    render(
      <FoldableSection id="x" title="Abos" count={3} foldable={false}>
        <p>inside</p>
      </FoldableSection>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('inside')).toBeInTheDocument();
  });
});
