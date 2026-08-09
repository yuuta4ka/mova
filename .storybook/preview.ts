import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: { default: 'Aurora', values: [{ name: 'Aurora', value: '#0D1017' }] },
    a11y: { test: 'error' },
  },
};

export default preview;
