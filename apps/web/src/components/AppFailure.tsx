import { Component, type ReactNode } from 'react';

export class AppFailure extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    const bangla = localStorage.getItem('locale') === 'bn';
    return (
      <main className="standalone">
        <h1>{bangla ? 'পৃষ্ঠাটি আবার খুলুন' : 'Please reopen this page'}</h1>
        <p>
          {bangla
            ? 'পৃষ্ঠাটি ঠিকমতো খোলা যায়নি। সংরক্ষণ না করা তথ্য পুনরায় লিখতে হতে পারে। কোনো বার্তা নিজে থেকে আবার পাঠানো হবে না।'
            : 'The page could not load correctly. Unsaved changes may need to be entered again. Messages will not be automatically resent.'}
        </p>
        <button className="button primary" onClick={() => location.reload()}>
          {bangla ? 'আবার খুলুন' : 'Reload page'}
        </button>
      </main>
    );
  }
}
