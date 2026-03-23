/**
 * Top 200 most common passwords (sourced from SecLists / NCSC).
 * Kept small to avoid bloating the bundle — covers the vast majority of weak passwords.
 * All lowercase for case-insensitive matching.
 */
export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  '1234567890', '12345', '1234', 'qwerty', 'abc123', 'monkey', 'master',
  'dragon', '111111', 'baseball', 'iloveyou', 'trustno1', 'sunshine',
  'ashley', 'football', 'shadow', '123123', '654321', 'superman',
  'qazwsx', 'michael', 'login', 'starwars', 'letmein', 'welcome',
  'admin', 'princess', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty123',
  'aa123456', 'access', 'flower', 'hottie', 'loveme', 'zaq1zaq1',
  'test', 'test123', 'love', 'god', 'adgjmptw', 'hello', 'charlie',
  'donald', 'password1!', 'qwerty1', 'iloveu', 'biteme', '!@#$%^&*',
  'george', 'computer', 'michelle', 'jessica', 'pepper', '1111',
  'zxcvbn', 'zxcvbnm', '555555', '11111111', '121212', '000000',
  'charlie', 'robert', 'thomas', 'hockey', 'ranger', 'daniel',
  'hunter', 'buster', 'joshua', 'pepper', 'matrix', 'silver',
  'jennifer', 'ginger', 'killer', 'soccer', 'pass', 'fuckyou',
  'andrea', 'tigger', 'batman', 'andrew', 'nicholas', 'summer',
  'internet', 'samantha', 'whatever', 'trustme', 'lakers', 'cowboys',
  'cheese', 'amanda', 'peanut', 'maggie', 'austin', 'william',
  'merlin', 'corvette', 'bigdog', 'cheese', 'matthew', 'patrick',
  'martin', 'freedom', 'ginger', 'blondie', 'sparky', 'diamond',
  'secret', 'asshole', 'hammer', 'silver', 'anthony', 'justin',
  'bailey', 'bandit', 'cooper', 'jordan', 'junior', 'yankees',
  'jasmine', 'brandon', 'johnny', 'dallas', 'madison', 'apple',
  'thunder', 'phoenix', 'camaro', 'rocket', 'falcon', 'harley',
  'orange', 'yankee', 'dakota', 'cookie', 'taylor', 'mickey',
  'abcdef', 'abcdefg', 'abcdefgh', '696969', 'qwertyuiop',
  'passpass', 'changeme', 'changeme123', 'letmein1', 'welcome1',
  'admin123', 'root', 'toor', 'user', 'guest', 'master123',
]);
