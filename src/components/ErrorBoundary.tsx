/**
 * React error boundary for graceful crash handling.
 */

import { Box, Text } from "ink";
import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>
            OpenHarness crashed
          </Text>
          <Text color="red">{this.state.error.message}</Text>
          <Text dimColor>Press Ctrl+C to exit, then restart with: oh</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
