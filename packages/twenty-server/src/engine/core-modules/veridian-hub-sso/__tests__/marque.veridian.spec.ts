import { replaceBrandInMessages } from '../../../../../../twenty-front/src/modules/veridian-brand/replaceBrandInMessages';

describe('replaceBrandInMessages', () => {
  it('renames the brand in plain and compiled messages', () => {
    expect(
      replaceBrandInMessages({
        a: 'Bienvenue sur Twenty',
        b: ['Twenty ', ['name'], ' Twenty'],
        c: ['count', 'plural', { one: ['Twenty'], other: ['#'] }],
      }),
    ).toEqual({
      a: 'Bienvenue sur Veridian CRM',
      b: ['Veridian CRM ', ['name'], ' Veridian CRM'],
      c: ['count', 'plural', { one: ['Veridian CRM'], other: ['#'] }],
    });
  });

  it('leaves urls, identifiers and the plain number alone', () => {
    const messages = {
      url: 'https://docs.twenty.com',
      paquet: 'twenty-sdk',
      collé: 'TwentyORM',
      nombre: 'twenty days',
    };

    expect(replaceBrandInMessages(messages)).toEqual(messages);
  });
});
