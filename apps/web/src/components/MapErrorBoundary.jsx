import { Component } from 'react';

/** Keeps a failure inside the interactive map from breaking the rest of the parking page. */
export default class MapErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Interactive map failed to render:', error); }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}
