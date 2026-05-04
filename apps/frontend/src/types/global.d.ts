interface Window {
  aptos?: {
    signMessage: (args: { address: boolean, message: string, nonce: string }) => Promise<{
      address: string;
      fullMessage: string;
      message: string;
      nonce: string;
      prefix: string;
      signature: string;
      bitmap?: string;
    }>;
  };
}

declare module '*.svg' {
  import * as React from 'react';
  export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>;
  const src: string;
  export default src;
}

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}
