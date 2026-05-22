export interface Contact {
    id: string;
    phoneNumber: string;
    name?: string;
    pushName?: string;
    profilePicture?: string;
    isBusiness: boolean;
    labels?: string[];
}