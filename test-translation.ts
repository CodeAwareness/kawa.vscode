/**
 * Sample TypeScript file for testing i18n translation
 * This file contains common programming constructs for translation testing
 */

// Simple function
function calculateTotal(price: number, quantity: number): number {
  const subtotal = price * quantity;
  const tax = subtotal * 0.1;
  return subtotal + tax;
}

// Class with methods
class UserManager {
  private users: Map<string, User> = new Map();

  addUser(user: User): void {
    if (this.users.has(user.id)) {
      throw new Error('User already exists');
    }
    this.users.set(user.id, user);
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  removeUser(id: string): boolean {
    return this.users.delete(id);
  }
}

// Interface
interface User {
  id: string;
  name: string;
  email: string;
  age: number;
}

// Type alias
type Status = 'pending' | 'active' | 'inactive';

// Async function with error handling
async function fetchUserData(userId: string): Promise<User | null> {
  try {
    const response = await fetch(`/api/users/${userId}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch user data:', error);
    return null;
  }
}

// Arrow function with destructuring
const processOrder = ({ orderId, items, customer }: Order) => {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  return {
    orderId,
    customerName: customer.name,
    total,
    status: 'processed' as Status,
  };
};

// Generic function
function firstElement<T>(array: T[]): T | undefined {
  return array[0];
}

// Export for module usage
export { calculateTotal, UserManager, fetchUserData, processOrder, firstElement };
export type { User, Status };
