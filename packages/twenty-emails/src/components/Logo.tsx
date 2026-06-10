import { Img } from '@react-email/components';

const logoStyle = {
  marginBottom: '40px',
};

// Veridian: self-hosted asset — app.twenty.com images acted as an
// unintentional tracking pixel for every email recipient
export const Logo = () => {
  return (
    <Img
      src="https://crm.app.veridian.site/images/icons/windows11/Square150x150Logo.scale-100.png"
      alt="Veridian CRM logo"
      width="40"
      height="40"
      style={logoStyle}
    />
  );
};
