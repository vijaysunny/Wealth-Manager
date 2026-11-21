import { View, Text } from './Theme';
import React from 'react';
import AppButton from './ui/AppButton';
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text>Something went wrong while opening this screen. Your saved data is retained.</Text>
        <AppButton title="Try again" onPress={() => this.setState({ error: null })} />
      </View>
    ) : (
      this.props.children
    );
  }
}
