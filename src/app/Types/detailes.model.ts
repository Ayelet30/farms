export type ParentDetails = {
  id: string;
  uid: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
};

export type ChildRow = {
  id: string;
  parent_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  class_id?: string;
  grade?: string;
  // הוסיפי כאן שדות רלוונטיים מהטבלה שלכם
};