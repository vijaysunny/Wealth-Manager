import React from 'react';
import { Text, View } from 'react-native';
import { tokens, type } from './tokens';
import AppButton from './ui/AppButton';
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      // A3: outside every provider, so it pins the light palette with its own background.
      <View
        testID="error-root"
        style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: tokens.light.bg }}
      >
        <Text style={[type.body, { color: tokens.light.text }]}>
          Something went wrong while opening this screen. Your saved data is retained.
        </Text>
        <AppButton title="Try again" onPress={() => this.setState({ error: null })} />
      </View>
    ) : (
      this.props.children
    );
  }
}
