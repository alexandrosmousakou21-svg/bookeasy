import { Component } from "react";
import { reportCriticalError } from "./lib/errorReporting";

export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    reportCriticalError(error, {
      feature: "application",
      operation: "react-render",
    });
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (this.state.failed) {
      return (
        <main className="error-fallback" role="alert">
          <h1>Κάτι πήγε στραβά.</h1>
          <p>Η εφαρμογή συνεχίζει να λειτουργεί. Δοκίμασε ξανά.</p>
          <button className="primary-button" onClick={this.retry}>
            Δοκίμασε ξανά
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
